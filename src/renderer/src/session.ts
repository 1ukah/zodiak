import {
  AudioPresets,
  ConnectionState,
  DisconnectReason,
  Room,
  RoomEvent,
  Track,
  type LocalTrackPublication,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
} from 'livekit-client'
import { closeSystemAudio, openSystemAudioTrack } from './system-audio'

export interface MediaTargets {
  video: HTMLVideoElement
  audio: HTMLAudioElement
}

export type Presence = 'offline' | 'connecting' | 'connected' | 'reconnecting'

export interface SessionHooks {
  onConnection: (state: Presence) => void
  onViewers: (count: number) => void
  onRemoteVideo: (active: boolean, participantName: string) => void
  onLocalVideo: (active: boolean) => void
  onAudioBlocked: (blocked: boolean) => void
  onError: (message: string) => void
}

let room: Room | null = null
let targets: MediaTargets | null = null
let hooks: SessionHooks | null = null
let suppressDisconnectError = false

export async function joinRoom(args: {
  url: string
  token: string
  subscribe: boolean
  media: MediaTargets
  hooks: SessionHooks
}): Promise<void> {
  await leaveRoom()
  targets = args.media
  hooks = args.hooks
  const next = new Room({
    adaptiveStream: true,
    dynacast: true,
    publishDefaults: {
      screenShareEncoding: { maxBitrate: 3_000_000, maxFramerate: 30 },
    },
  })
  room = next
  bindRoom(next)
  try {
    await next.connect(args.url, args.token, { autoSubscribe: args.subscribe })
  } catch (error) {
    room = null
    await next.disconnect()
    throw error instanceof Error ? error : new Error('Could not connect')
  }
  hooks.onConnection(toPresence(next.state))
  hooks.onViewers(next.remoteParticipants.size)
  if (args.subscribe) refreshRemoteMedia(next)
}

export async function publishScreen(withAudio: boolean): Promise<void> {
  const current = requireRoom()
  try {
    await enableShare(current, withAudio)
  } catch (error) {
    await closeSystemAudio()
    await current.localParticipant.setScreenShareEnabled(false).catch(() => undefined)
    throw error instanceof Error ? error : new Error('Screen share did not start')
  }
}

export async function unpublishScreen(): Promise<void> {
  const current = requireRoom()
  detachLocalScreen(current)
  const audioPublication = current.localParticipant.getTrackPublication(Track.Source.ScreenShareAudio)
  if (audioPublication?.track) await current.localParticipant.unpublishTrack(audioPublication.track, true)
  await closeSystemAudio()
  await current.localParticipant.setScreenShareEnabled(false)
  hooks?.onLocalVideo(false)
}

export async function leaveRoom(): Promise<void> {
  await closeSystemAudio()
  const current = room
  room = null
  suppressDisconnectError = true
  try {
    if (current) await current.disconnect()
  } finally {
    suppressDisconnectError = false
    clearMedia()
  }
}

function requireRoom(): Room {
  if (!room) throw new Error('Not connected')
  return room
}

async function enableShare(current: Room, withAudio: boolean): Promise<void> {
  if (!targets) throw new Error('Preview is not ready')
  let publication: LocalTrackPublication | undefined
  try {
    publication = await current.localParticipant.setScreenShareEnabled(true, {
      audio: false,
      contentHint: 'detail',
      resolution: { width: 1920, height: 1080, frameRate: 30 },
    })
  } catch (error) {
    throw new Error(captureMessage(error))
  }
  const track = publication?.track
  if (!track || track.kind !== Track.Kind.Video) {
    throw new Error('Screen share did not start. Choose a screen and try again.')
  }
  targets.video.muted = true
  track.attach(targets.video)
  hooks?.onLocalVideo(true)
  if (!withAudio) return
  const audioTrack = await openSystemAudioTrack()
  try {
    await current.localParticipant.publishTrack(audioTrack, {
      source: Track.Source.ScreenShareAudio,
      name: 'screen_audio',
      forceStereo: true,
      audioPreset: AudioPresets.musicStereo,
    })
  } catch (error) {
    await closeSystemAudio()
    throw error instanceof Error ? error : new Error('System audio did not start')
  }
}

function detachLocalScreen(current: Room): void {
  current.localParticipant.getTrackPublication(Track.Source.ScreenShare)?.track?.detach()
  current.localParticipant.getTrackPublication(Track.Source.ScreenShareAudio)?.track?.detach()
}

function bindRoom(next: Room): void {
  next.on(RoomEvent.ConnectionStateChanged, (state) => {
    if (room !== next) return
    hooks?.onConnection(toPresence(state))
  })
  next.on(RoomEvent.ParticipantConnected, () => {
    if (room !== next) return
    hooks?.onViewers(next.remoteParticipants.size)
  })
  next.on(RoomEvent.ParticipantDisconnected, () => {
    if (room !== next) return
    hooks?.onViewers(next.remoteParticipants.size)
    refreshRemoteMedia(next)
  })
  next.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
    if (room !== next) return
    void attachRemote(track, publication, participant)
  })
  next.on(RoomEvent.TrackUnsubscribed, (track) => {
    if (room !== next) return
    track.detach()
    refreshRemoteMedia(next)
  })
  next.on(RoomEvent.Disconnected, (reason) => {
    if (room !== next) return
    hooks?.onConnection('offline')
    if (!suppressDisconnectError && reason !== undefined && reason !== DisconnectReason.CLIENT_INITIATED) {
      hooks?.onError(`Disconnected (${reasonLabel(reason)})`)
    }
    clearMedia()
  })
  next.on(RoomEvent.MediaDevicesError, (error) => {
    if (room !== next) return
    hooks?.onError(error.message)
  })
}

function refreshRemoteMedia(next: Room): void {
  const media = targets
  if (!media) return
  if (next.localParticipant.getTrackPublication(Track.Source.ScreenShare)?.track) return
  let videoName = ''
  next.remoteParticipants.forEach((participant) => {
    participant.trackPublications.forEach((publication) => {
      const track = publication.track
      if (!track || !isScreenVideo(track)) return
      track.attach(media.video)
      videoName = participant.name || participant.identity
    })
  })
  if (!videoName) media.video.srcObject = null
  hooks?.onRemoteVideo(videoName !== '', videoName)
}

async function attachRemote(
  track: RemoteTrack,
  publication: RemoteTrackPublication,
  participant: RemoteParticipant,
): Promise<void> {
  if (!targets) return
  if (publication.source !== Track.Source.ScreenShare && publication.source !== Track.Source.ScreenShareAudio) return
  if (isScreenVideo(track)) {
    track.attach(targets.video)
    hooks?.onRemoteVideo(true, participant.name || participant.identity)
    return
  }
  if (isScreenAudio(track)) {
    track.attach(targets.audio)
    try {
      await targets.audio.play()
      hooks?.onAudioBlocked(false)
    } catch {
      hooks?.onAudioBlocked(true)
    }
  }
}

function isScreenVideo(track: RemoteTrack): boolean {
  return track.kind === Track.Kind.Video && track.source === Track.Source.ScreenShare
}

function isScreenAudio(track: RemoteTrack): boolean {
  return track.kind === Track.Kind.Audio && track.source === Track.Source.ScreenShareAudio
}

function clearMedia(): void {
  if (targets) {
    targets.video.srcObject = null
    targets.audio.srcObject = null
  }
  hooks?.onLocalVideo(false)
  hooks?.onRemoteVideo(false, '')
  hooks?.onAudioBlocked(false)
}

function captureMessage(error: unknown): string {
  if (!(error instanceof Error)) return 'Screen share did not start'
  if (/notallowed|permission denied|permission/i.test(error.message)) {
    return 'Screen capture was blocked. Choose a screen and try again.'
  }
  return error.message
}

function toPresence(state: ConnectionState): Presence {
  if (state === ConnectionState.Connecting) return 'connecting'
  if (state === ConnectionState.Reconnecting || state === ConnectionState.SignalReconnecting) return 'reconnecting'
  if (state === ConnectionState.Connected) return 'connected'
  return 'offline'
}

function reasonLabel(reason: DisconnectReason): string {
  const name = DisconnectReason[reason]
  if (typeof name !== 'string') return 'lost connection'
  return name.replaceAll('_', ' ').toLowerCase()
}
