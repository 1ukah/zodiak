import {
  ConnectionState,
  DisconnectReason,
  Room,
  RoomEvent,
  Track,
  type LocalTrackPublication,
  type LocalVideoTrack,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  type RemoteVideoTrack,
} from 'livekit-client'
import { shareBitrateFor, type SharePriority, type ShareQuality } from '../../shared/types'
import { closeSystemAudio, openSystemAudioTrack } from './system-audio'
import { CHAT_MAX_BYTES, CHAT_MAX_LENGTH, CHAT_TOPIC, parseChatPacket, type ChatMessage, type ChatPacket } from '../../shared/chat'

export interface MediaTargets {
  video: HTMLVideoElement
  audioRack: HTMLElement
}

export interface RoomParticipant {
  id: string
  name: string
  local: boolean
}

export interface RosterParticipant {
  id: string
  name: string
}

export interface ScreenStream {
  id: string
  participantId: string
  participantName: string
  local: boolean
  muted: boolean
  /** A remote stream is only decoded after the viewer explicitly watches it. */
  subscribed: boolean
}

export interface StreamMetric {
  bytes: number
  bitrate: number
  packetRate: number
  packets: number
  frames: number
  packetsLost?: number
  frameRate?: number
  width?: number
  height?: number
  captureWidth?: number
  captureHeight?: number
  captureFrameRate?: number
  targetBitrate?: number
  maxBitrate?: number
  qualityLimitationReason?: string
  qualityLimitationDurationMs?: number
  framesDropped?: number
  codec?: string
  decoder?: string
  packetLossPercent?: number
  roundTripTimeMs?: number
  jitterMs?: number
  jitterBufferDelayMs?: number
  decodeTimeMs?: number
}

export interface StreamTelemetry {
  sent?: StreamMetric
  received?: StreamMetric
}

export type Presence = 'offline' | 'connecting' | 'connected' | 'reconnecting'

export interface SessionHooks {
  /** Unexpected disconnects only; explicit leave/switch never emits this. */
  onRoomLost?: () => void
  onChatMessage: (message: ChatMessage) => void
  onConnection: (state: Presence) => void
  onViewers: (count: number) => void
  onParticipants: (participants: RoomParticipant[]) => void
  onStreams: (streams: ScreenStream[]) => void
  onTelemetry: (telemetry: StreamTelemetry) => void
  onAudioBlocked: (blocked: boolean) => void
  onError: (message: string) => void
}

interface StreamRecord extends ScreenStream {
  track?: LocalVideoTrack | RemoteVideoTrack
  publication?: RemoteTrackPublication
}

interface RemoteAudioGraph {
  receiverElement: HTMLAudioElement
  source: MediaStreamAudioSourceNode
  gain: GainNode
  destination: MediaStreamAudioDestinationNode
}

let room: Room | null = null
let targets: MediaTargets | null = null
let hooks: SessionHooks | null = null
let suppressDisconnectError = false
let selectedStreamId: string | null = null
let selectedTrack: LocalVideoTrack | RemoteVideoTrack | null = null
let stageVideoVisible = true
let streams = new Map<string, StreamRecord>()
let mutedParticipants = new Set<string>()
let hiddenParticipants = new Set<string>()
let remoteAudio = new Map<string, HTMLAudioElement>()
let remoteAudioTracks = new Map<string, RemoteTrack>()
let remoteAudioGraphs = new Map<string, RemoteAudioGraph>()
let audioContext: AudioContext | null = null
let remoteAudioVolume = 1
let remoteStreamVolumes = new Map<string, number>()
let remoteAudioOutputDeviceId = ''
let gridTargets = new Map<string, HTMLVideoElement>()
let gridTracks = new Map<string, LocalVideoTrack | RemoteVideoTrack>()
let statsTimer: ReturnType<typeof window.setInterval> | null = null
let rosterTimer: ReturnType<typeof window.setInterval> | null = null
let rosterProvider: (() => Promise<RosterParticipant[]>) | null = null
let rosterRequestInFlight = false
let lastStats = new Map<string, CounterSample>()
let telemetryInFlight = false
let localScreenTargetBitrate: number | undefined
let localParticipantName: string | undefined
const receivedChatIds = new Set<string>()
const participantNameCollator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

interface CounterSample {
  bytes: number
  packets: number
  packetsLost: number
  frames: number
  timestamp: number
}

// The selected profile is an upper bound. WebRTC always retains congestion
// control, including with a fixed target, to avoid overwhelming the network.
export async function joinRoom(args: {
  url: string
  token: string
  subscribe: boolean
  media: MediaTargets
  hooks: SessionHooks
  roster?: () => Promise<RosterParticipant[]>
}): Promise<void> {
  await leaveRoom()
  receivedChatIds.clear()
  targets = args.media
  hooks = args.hooks
  rosterProvider = args.roster ?? null
  const next = new Room({
    // Let WebRTC and LiveKit select an efficient layer for each tile. This is
    // essential when multiple streams are visible and avoids starving the
    // encoder after a long session.
    adaptiveStream: true,
    dynacast: true,
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
  refreshParticipants(next)
  refreshStreams(next)
  void refreshRoster(next)
  startRosterSync(next)
  startTelemetry(next)
}

export async function publishScreen(withAudio: boolean, excludeDiscord: boolean, quality: ShareQuality): Promise<void> {
  const current = requireRoom()
  const dimensions = dimensionsFor(quality)
  const preference = encodingPreferenceFor(quality.priority)
  let protectedAudio: MediaStreamTrack | null = null
  try {
    if (withAudio) protectedAudio = await openSystemAudioTrack(excludeDiscord)
    const publication = await current.localParticipant.setScreenShareEnabled(
      true,
      {
        // Chromium loopback is already mixed. Publish the protected WASAPI
        // process-loopback track instead so this app's audio cannot feed back.
        audio: false,
        contentHint: preference.contentHint,
        resolution: { width: dimensions.width, height: dimensions.height, frameRate: quality.frameRate },
      },
      {
        videoCodec: 'h264',
        simulcast: false,
        degradationPreference: preference.degradationPreference,
        screenShareEncoding: {
          // The selected profile is the encoder ceiling. Browsers expose no
          // minimum bitrate, so congestion control can still reduce the actual
          // send rate, including when the user selects a fixed target.
          maxBitrate: shareBitrateFor(quality),
          maxFramerate: quality.frameRate,
          priority: 'high',
        },
      },
    )
    const track = publication?.track
    if (!track || track.kind !== Track.Kind.Video) {
      throw new Error('Screen share did not start. Choose a screen and try again.')
    }
    localScreenTargetBitrate = shareBitrateFor(quality)
    if (protectedAudio) {
      await current.localParticipant.publishTrack(protectedAudio, {
        source: Track.Source.ScreenShareAudio,
        name: 'screen-audio',
        stream: 'screen',
      })
    }
    refreshStreams(current)
  } catch (error) {
    localScreenTargetBitrate = undefined
    await current.localParticipant.setScreenShareEnabled(false).catch(() => undefined)
    await closeSystemAudio()
    throw new Error(captureMessage(error))
  }
}

/** Updates the local participant and lets LiveKit broadcast the new name. */
export async function updateDisplayName(name: string): Promise<void> {
  const current = requireRoom()
  await current.localParticipant.setName(name)
  localParticipantName = name
  refreshParticipants(current)
  refreshStreams(current)
}

export async function sendChatMessage(text: string, recipient?: string): Promise<ChatMessage> {
  const current = requireRoom()
  if (current.state !== ConnectionState.Connected) throw new Error('Wait for the room to reconnect.')
  if (!text.trim() || text.length > CHAT_MAX_LENGTH) throw new Error(`Messages can contain up to ${CHAT_MAX_LENGTH} characters.`)
  if (recipient && !current.remoteParticipants.has(recipient)) throw new Error('This person has left the room.')
  const packet: ChatPacket = { version: 1, id: crypto.randomUUID(), text: text.trim(), timestamp: Date.now(), ...(recipient ? { recipient } : {}) }
  const data = new TextEncoder().encode(JSON.stringify(packet))
  if (data.byteLength > CHAT_MAX_BYTES) throw new Error('This message is too large.')
  await current.localParticipant.publishData(data, { reliable: true, topic: CHAT_TOPIC, ...(recipient ? { destinationIdentities: [recipient] } : {}) })
  if (room !== current) throw new Error('You left the room before the message was sent.')
  return { ...packet, senderId: current.localParticipant.identity, senderName: displayNameForLocal(current), local: true }
}

export async function unpublishScreen(): Promise<void> {
  const current = requireRoom()
  await current.localParticipant.setScreenShareEnabled(false)
  localScreenTargetBitrate = undefined
  await closeSystemAudio()
  refreshStreams(current)
}

export function selectStream(id: string | null): void {
  selectedStreamId = id
  attachSelectedVideo()
}

/** Starts receiving one screen (and its paired screen audio) on demand. */
export function watchStream(id: string): void {
  const record = streams.get(id)
  if (!record) return
  selectedStreamId = id
  if (!record.local && record.publication) {
    hiddenParticipants.delete(record.participantId)
    record.publication.setSubscribed(true)
    setParticipantScreenAudioSubscribed(record.participantId, true)
  }
  attachSelectedVideo()
}

/** Unsubscribes a remote screen completely, stopping its network, decode, and audio work. */
export function hideStream(id: string): void {
  const record = streams.get(id)
  if (!record || record.local || !record.publication) return
  hiddenParticipants.add(record.participantId)
  record.publication.setSubscribed(false)
  setParticipantScreenAudioSubscribed(record.participantId, false)
  record.track?.detach()
  const gridTarget = gridTargets.get(id)
  if (gridTarget) record.track?.detach(gridTarget)
  gridTracks.delete(id)
  removeRemoteAudio(record.participantId)
  // Do not wait for the SFU's unsubscribe acknowledgement before dropping the
  // DOM/media references. This makes hiding immediately stop local rendering.
  record.track = undefined
  record.subscribed = false
  if (selectedStreamId === id) selectedStreamId = null
  attachSelectedVideo()
  emitStreams()
}

/** Stops decoding the hidden single-stage preview while the grid is active. */
export function setStageVideoVisible(visible: boolean): void {
  if (stageVideoVisible === visible) return
  stageVideoVisible = visible
  attachSelectedVideo()
}

/** Attach every visible screen to the supplied grid video elements. */
export function setGridVideos(next: Map<string, HTMLVideoElement>): void {
  gridTracks.forEach((track, id) => {
    const target = gridTargets.get(id)
    if (target) track.detach(target)
  })
  gridTracks.clear()
  gridTargets = next
  syncGridVideos()
}

export function setStreamMuted(id: string, muted: boolean): void {
  const record = streams.get(id)
  if (!record || record.local) return
  if (muted) mutedParticipants.add(record.participantId)
  else mutedParticipants.delete(record.participantId)
  const element = remoteAudio.get(record.participantId)
  if (element) {
    element.muted = muted
    applyAudioVolume(record.participantId, element)
  }
  refreshStreams(requireRoom())
}

/** Applies a relative volume to one remote screen-audio track. */
export function setStreamVolume(id: string, volume: number): void {
  const record = streams.get(id)
  if (!record || record.local) return
  const next = Math.max(0, Math.min(1, volume))
  remoteStreamVolumes.set(record.participantId, next)
  const element = remoteAudio.get(record.participantId)
  if (element) applyAudioVolume(record.participantId, element)
}

/** Applies a single playback level to every remote screen-audio track. */
export function setRemoteAudioVolume(volume: number): void {
  remoteAudioVolume = Math.max(0, Math.min(2, volume))
  remoteAudio.forEach((element, identity) => applyAudioVolume(identity, element))
}

/** Routes remote stream audio to a Windows output device when Chromium supports it. */
export async function setRemoteAudioOutputDevice(deviceId: string): Promise<void> {
  const previous = remoteAudioOutputDeviceId
  remoteAudioOutputDeviceId = deviceId
  try {
    await Promise.all([...remoteAudio.values()].map((element) => setSinkId(element, deviceId)))
  } catch (error) {
    remoteAudioOutputDeviceId = previous
    // Return existing audio to the selected device if one element rejected the
    // new sink (for example, because it was unplugged mid-selection).
    await Promise.allSettled([...remoteAudio.values()].map((element) => setSinkId(element, previous)))
    throw error
  }
}

export function supportsRemoteAudioOutputSelection(): boolean {
  return typeof (HTMLMediaElement.prototype as HTMLMediaElement & { setSinkId?: unknown }).setSinkId === 'function'
}

/** Retries both Web Audio and element playback after a viewer gesture. */
export async function resumeRemoteAudio(): Promise<void> {
  try {
    await Promise.all([
      audioContext?.resume(),
      ...[...remoteAudioGraphs.values()].map(({ receiverElement }) => receiverElement.play()),
      ...[...remoteAudio.values()].map((element) => element.play()),
    ])
    hooks?.onAudioBlocked(false)
  } catch {
    hooks?.onAudioBlocked(true)
  }
}

export async function leaveRoom(): Promise<void> {
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

function bindRoom(next: Room): void {
  next.on(RoomEvent.DataReceived, (data, participant, _kind, topic) => {
    if (room !== next || topic !== CHAT_TOPIC || !participant) return
    const packet = parseChatPacket(data)
    if (!packet || (packet.recipient && packet.recipient !== next.localParticipant.identity)) return
    const key = `${participant.identity}:${packet.id}`
    if (receivedChatIds.has(key)) return
    receivedChatIds.add(key)
    if (receivedChatIds.size > 5_000) receivedChatIds.delete(receivedChatIds.values().next().value!)
    hooks?.onChatMessage({ ...packet, timestamp: Math.abs(Date.now() - packet.timestamp) < 300_000 ? packet.timestamp : Date.now(), senderId: participant.identity, senderName: participant.name || participant.identity, local: false })
  })
  next.on(RoomEvent.ConnectionStateChanged, (state) => {
    if (room !== next) return
    hooks?.onConnection(toPresence(state))
    if (state === ConnectionState.Connected) refreshRoomState(next)
  })
  next.on(RoomEvent.ParticipantConnected, () => {
    if (room === next) refreshRoomState(next)
  })
  next.on(RoomEvent.ParticipantDisconnected, () => {
    if (room === next) refreshRoomState(next)
  })
  next.on(RoomEvent.ParticipantNameChanged, () => {
    if (room === next) refreshRoomState(next)
  })
  next.on(RoomEvent.Reconnected, () => {
    if (room === next) refreshRoomState(next)
  })
  next.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
    if (room !== next) return
    if (isScreenAudio(track)) void attachAudio(track, participant)
    refreshStreams(next)
  })
  next.on(RoomEvent.TrackUnsubscribed, (track) => {
    if (room !== next) return
    track.detach()
    refreshStreams(next)
  })
  next.on(RoomEvent.TrackPublished, () => {
    if (room === next) refreshStreams(next)
  })
  next.on(RoomEvent.TrackUnpublished, () => {
    if (room === next) refreshStreams(next)
  })
  next.on(RoomEvent.LocalTrackPublished, () => {
    if (room === next) refreshStreams(next)
  })
  next.on(RoomEvent.LocalTrackUnpublished, () => {
    if (room === next) refreshStreams(next)
  })
  next.on(RoomEvent.Disconnected, (reason) => {
    if (room !== next) return
    hooks?.onConnection('offline')
    if (!suppressDisconnectError && reason !== DisconnectReason.CLIENT_INITIATED) hooks?.onRoomLost?.()
    if (!suppressDisconnectError && reason !== undefined && reason !== DisconnectReason.CLIENT_INITIATED) {
      hooks?.onError(`Disconnected (${reasonLabel(reason)})`)
    }
    clearMedia()
  })
  next.on(RoomEvent.MediaDevicesError, (error) => {
    if (room === next) hooks?.onError(error.message)
  })
}

function refreshRoomState(current: Room): void {
  hooks?.onViewers(current.remoteParticipants.size)
  refreshParticipants(current)
  refreshStreams(current)
  void refreshRoster(current)
}

function refreshStreams(current: Room): void {
  const next = new Map<string, StreamRecord>()
  addLocalStream(
    next,
    current.localParticipant.getTrackPublication(Track.Source.ScreenShare),
    current.localParticipant.identity,
    displayNameForLocal(current),
  )
  current.remoteParticipants.forEach((participant) => {
    participant.trackPublications.forEach((publication) => addRemoteStream(next, publication, participant))
  })
  streams = next
  syncRemoteAudio(current)
  if (selectedStreamId && !streams.has(selectedStreamId)) selectedStreamId = null
  attachSelectedVideo()
  syncGridVideos()
  emitStreams()
}

function emitStreams(): void {
  hooks?.onStreams([...streams.values()].map(({ track: _track, publication: _publication, ...stream }) => stream))
}

function refreshParticipants(current: Room): void {
  const next: RoomParticipant[] = [{
    id: current.localParticipant.identity,
    name: displayNameForLocal(current),
    local: true,
  }]
  current.remoteParticipants.forEach((participant) => {
    next.push({ id: participant.identity, name: participant.name || participant.identity, local: false })
  })
  emitParticipants(next)
}

/**
 * The SDK and the server roster can return the same people in different
 * orders. Normalize at the session boundary so a roster refresh never moves
 * otherwise unchanged participant tiles.
 */
function emitParticipants(next: RoomParticipant[]): void {
  hooks?.onParticipants([...next].sort((left, right) => {
    const byName = participantNameCollator.compare(left.name, right.name)
    return byName || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
  }))
}

/**
 * LiveKit's participant events update the UI immediately. This server roster
 * check is a reconciliation path for reconnects or missed signaling events.
 */
async function refreshRoster(current: Room): Promise<void> {
  if (!rosterProvider || rosterRequestInFlight || room !== current) return
  rosterRequestInFlight = true
  try {
    const roster = await rosterProvider()
    if (room !== current) return
    const local = {
      id: current.localParticipant.identity,
      name: displayNameForLocal(current),
      local: true,
    }
    const remotes = roster
      .filter((participant) => participant.id !== local.id)
      .map((participant) => ({ ...participant, local: false }))
    hooks?.onViewers(remotes.length)
    emitParticipants([local, ...remotes])
  } catch {
    // The SDK's live roster remains displayed while the server is unavailable.
  } finally {
    rosterRequestInFlight = false
  }
}

function startRosterSync(current: Room): void {
  if (rosterTimer !== null) window.clearInterval(rosterTimer)
  rosterTimer = null
  if (!rosterProvider) return
  rosterTimer = window.setInterval(() => void refreshRoster(current), 2_000)
}

function stopRosterSync(): void {
  if (rosterTimer !== null) window.clearInterval(rosterTimer)
  rosterTimer = null
  rosterRequestInFlight = false
  rosterProvider = null
}

function displayNameForLocal(current: Room): string {
  return localParticipantName || current.localParticipant.name || 'You'
}

function addLocalStream(
  destination: Map<string, StreamRecord>,
  publication: LocalTrackPublication | undefined,
  identity: string,
  name: string | undefined,
): void {
  const track = publication?.track
  if (!track || track.kind !== Track.Kind.Video || track.source !== Track.Source.ScreenShare) return
  const id = `local:${publication.trackSid ?? 'screen'}`
  destination.set(id, { id, participantId: identity, participantName: name || 'You', local: true, muted: false, subscribed: true, track: track as LocalVideoTrack })
}

function addRemoteStream(destination: Map<string, StreamRecord>, publication: RemoteTrackPublication, participant: RemoteParticipant): void {
  const track = publication.track
  if (publication.kind !== Track.Kind.Video || publication.source !== Track.Source.ScreenShare) return
  const id = `remote:${participant.identity}:${publication.trackSid}`
  destination.set(id, {
    id,
    participantId: participant.identity,
    participantName: participant.name || participant.identity,
    local: false,
    muted: mutedParticipants.has(participant.identity),
    subscribed: publication.isSubscribed && !hiddenParticipants.has(participant.identity),
    track: track && isScreenVideo(track) ? track : undefined,
    publication,
  })
}

function attachSelectedVideo(): void {
  const media = targets
  if (!media) return
  if (selectedTrack) selectedTrack.detach(media.video)
  selectedTrack = null
  if (!stageVideoVisible) {
    media.video.pause()
    media.video.srcObject = null
    return
  }
  const selected = selectedStreamId ? streams.get(selectedStreamId) : undefined
  if (!selected?.track) {
    media.video.pause()
    media.video.srcObject = null
    return
  }
  media.video.muted = selected.local
  selected.track.attach(media.video)
  void media.video.play().catch(() => undefined)
  selectedTrack = selected.track
}

function syncGridVideos(): void {
  gridTracks.forEach((track, id) => {
    const target = gridTargets.get(id)
    if (target && streams.get(id)?.track === track) return
    if (target) track.detach(target)
    gridTracks.delete(id)
  })
  gridTargets.forEach((target, id) => {
    const record = streams.get(id)
    if (!record?.track || gridTracks.has(id)) return
    target.muted = record.local
    record.track.attach(target)
    void target.play().catch(() => undefined)
    gridTracks.set(id, record.track)
  })
}

function syncRemoteAudio(current: Room): void {
  const wanted = new Map<string, { track: RemoteTrack; participant: RemoteParticipant }>()
  current.remoteParticipants.forEach((participant) => {
    participant.trackPublications.forEach((publication) => {
      const track = publication.track
      if (track && isScreenAudio(track) && !hiddenParticipants.has(participant.identity)) wanted.set(participant.identity, { track, participant })
    })
  })
  remoteAudio.forEach((element, identity) => {
    if (wanted.has(identity)) return
    removeRemoteAudio(identity)
  })
  wanted.forEach(({ track, participant }) => void attachAudio(track, participant))
}

async function attachAudio(track: RemoteTrack, participant: RemoteParticipant): Promise<void> {
  const media = targets
  if (!media || !isScreenAudio(track) || hiddenParticipants.has(participant.identity)) return
  let element = remoteAudio.get(participant.identity)
  if (!element) {
    element = document.createElement('audio')
    element.autoplay = true
    element.volume = 1
    media.audioRack.append(element)
    remoteAudio.set(participant.identity, element)
  }
  try {
    if (remoteAudioTracks.get(participant.identity) !== track) {
      disconnectRemoteAudioGraph(participant.identity)
      audioContext ??= new AudioContext()
      // Chromium's MediaElementAudioSource does not intercept WebRTC playback.
      // Process the received track directly, then play ONLY the processed stream
      // through the element so mute and setSinkId still control the audible path.
      const stream = new MediaStream([track.mediaStreamTrack])
      // Keep Chromium's remote receiver pulling audio even when only Web Audio
      // consumes it. This element is always silent and is never a user output.
      const receiverElement = document.createElement('audio')
      receiverElement.muted = true
      receiverElement.volume = 0
      receiverElement.srcObject = stream
      const source = audioContext.createMediaStreamSource(stream)
      const gain = audioContext.createGain()
      const destination = audioContext.createMediaStreamDestination()
      gain.gain.value = 0
      source.connect(gain).connect(destination)
      remoteAudioGraphs.set(participant.identity, { receiverElement, source, gain, destination })
      element.srcObject = destination.stream
      remoteAudioTracks.set(participant.identity, track)
    }
    applyAudioVolume(participant.identity, element)
    element.muted = mutedParticipants.has(participant.identity)
    await Promise.all([audioContext?.resume(), remoteAudioGraphs.get(participant.identity)?.receiverElement.play()])
    if (remoteAudio.get(participant.identity) !== element || remoteAudioTracks.get(participant.identity) !== track) return
    await setSinkId(element, remoteAudioOutputDeviceId)
    if (remoteAudio.get(participant.identity) !== element || remoteAudioTracks.get(participant.identity) !== track) return
    await element.play()
    if (remoteAudio.get(participant.identity) === element && remoteAudioTracks.get(participant.identity) === track) hooks?.onAudioBlocked(false)
  } catch {
    if (remoteAudio.get(participant.identity) === element) hooks?.onAudioBlocked(true)
  }
}

function setParticipantScreenAudioSubscribed(identity: string, subscribed: boolean): void {
  const current = room
  const participant = current?.remoteParticipants.get(identity)
  participant?.trackPublications.forEach((publication) => {
    if (publication.source === Track.Source.ScreenShareAudio) publication.setSubscribed(subscribed)
  })
}

function removeRemoteAudio(identity: string): void {
  disconnectRemoteAudioGraph(identity)
  const element = remoteAudio.get(identity)
  if (element) {
    element.pause()
    element.srcObject = null
    element.remove()
  }
  remoteAudio.delete(identity)
  remoteAudioTracks.delete(identity)
}

function applyAudioVolume(identity: string, element: HTMLAudioElement): void {
  const volume = mutedParticipants.has(identity) ? 0 : remoteAudioVolume * (remoteStreamVolumes.get(identity) ?? 1)
  const gain = remoteAudioGraphs.get(identity)?.gain
  if (gain) {
    gain.gain.value = volume
    element.volume = 1
  }
}

function disconnectRemoteAudioGraph(identity: string): void {
  const graph = remoteAudioGraphs.get(identity)
  if (!graph) return
  graph.receiverElement.pause()
  graph.receiverElement.srcObject = null
  graph.source.disconnect()
  graph.gain.disconnect()
  graph.destination.stream.getTracks().forEach((track) => track.stop())
  remoteAudioGraphs.delete(identity)
}

function setSinkId(element: HTMLAudioElement, deviceId: string): Promise<void> {
  const sinkable = element as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }
  if (!sinkable.setSinkId) return Promise.resolve()
  return sinkable.setSinkId(deviceId)
}

function isScreenVideo(track: RemoteTrack): track is RemoteVideoTrack {
  return track.kind === Track.Kind.Video && track.source === Track.Source.ScreenShare
}

function isScreenAudio(track: RemoteTrack): boolean {
  return track.kind === Track.Kind.Audio && track.source === Track.Source.ScreenShareAudio
}

function clearMedia(): void {
  stopRosterSync()
  stopTelemetry()
  if (selectedTrack && targets) selectedTrack.detach(targets.video)
  selectedTrack = null
  stageVideoVisible = true
  gridTracks.forEach((track, id) => {
    const target = gridTargets.get(id)
    if (target) track.detach(target)
  })
  gridTracks.clear()
  gridTargets.clear()
  streams.clear()
  selectedStreamId = null
  mutedParticipants.clear()
  hiddenParticipants.clear()
  remoteAudio.forEach((_element, identity) => removeRemoteAudio(identity))
  const context = audioContext
  audioContext = null
  if (context) void context.close().catch(() => undefined)
  remoteStreamVolumes.clear()
  localScreenTargetBitrate = undefined
  localParticipantName = undefined
  if (targets) targets.video.srcObject = null
  hooks?.onStreams([])
  hooks?.onParticipants([])
  hooks?.onTelemetry({})
  hooks?.onAudioBlocked(false)
}

function startTelemetry(current: Room): void {
  stopTelemetry()
  const collect = (): void => {
    if (room !== current) return
    if (telemetryInFlight) return
    telemetryInFlight = true
    void collectTelemetry(current).finally(() => { telemetryInFlight = false })
  }
  collect()
  statsTimer = window.setInterval(collect, 1000)
}

function stopTelemetry(): void {
  if (statsTimer !== null) window.clearInterval(statsTimer)
  statsTimer = null
  telemetryInFlight = false
  lastStats.clear()
}

async function collectTelemetry(current: Room): Promise<void> {
  const localTrack = current.localParticipant.getTrackPublication(Track.Source.ScreenShare)?.track as LocalVideoTrack | undefined
  const selected = selectedStreamId ? streams.get(selectedStreamId) : undefined
  const telemetry: StreamTelemetry = {}
  if (localTrack?.kind === Track.Kind.Video) {
    const senderStats = await localTrack.getSenderStats().catch(() => [])
    const primary = senderStats.reduce((largest, stat) => (stat.bytesSent ?? 0) > (largest?.bytesSent ?? 0) ? stat : largest, senderStats[0])
    if (primary) {
      const metric = toMetric('sent', primary as unknown as Record<string, unknown>)
      enrichNetworkMetrics(metric, senderStats as unknown as Array<Record<string, unknown>>)
      // This is our cap; retain Chromium's own target bitrate separately so the
      // diagnostics can distinguish a configured limit from bandwidth estimation.
      metric.maxBitrate = localScreenTargetBitrate
      const settings = localTrack.mediaStreamTrack.getSettings()
      metric.captureWidth = numberValue(settings.width)
      metric.captureHeight = numberValue(settings.height)
      metric.captureFrameRate = numberValue(settings.frameRate)
      telemetry.sent = metric
    }
  }
  if (selected && !selected.local) {
    const receiverStats = await (selected.track as RemoteVideoTrack).getReceiverStats().catch(() => undefined)
    if (receiverStats) {
      const record = receiverStats as unknown as Record<string, unknown>
      const metric = toMetric(`received:${selected.id}`, record)
      enrichNetworkMetrics(metric, [record])
      telemetry.received = metric
    }
  }
  if (room === current) hooks?.onTelemetry(telemetry)
}

function toMetric(key: string, stat: Record<string, unknown>): StreamMetric {
  const bytes = numberValue(stat.bytesSent ?? stat.bytesReceived)
  const packets = numberValue(stat.packetsSent ?? stat.packetsReceived)
  const packetsLost = numberValue(stat.packetsLost)
  const frames = numberValue(stat.framesSent ?? stat.framesDecoded ?? stat.framesReceived)
  const timestamp = numberValue(stat.timestamp) || performance.now()
  const previous = lastStats.get(key)
  lastStats.set(key, { bytes, packets, packetsLost, frames, timestamp })
  const seconds = previous ? Math.max((timestamp - previous.timestamp) / 1000, 0.001) : 0
  const lostDelta = previous ? Math.max(0, packetsLost - previous.packetsLost) : 0
  const packetDelta = previous ? Math.max(0, packets - previous.packets) : 0
  return {
    bytes,
    bitrate: previous ? Math.max(0, ((bytes - previous.bytes) * 8) / seconds) : 0,
    packetRate: previous ? Math.max(0, (packets - previous.packets) / seconds) : 0,
    packets,
    frames,
    packetsLost,
    packetLossPercent: previous && packetDelta + lostDelta > 0 ? (lostDelta / (packetDelta + lostDelta)) * 100 : undefined,
    frameRate: numberValue(stat.framesPerSecond) || (previous ? Math.max(0, (frames - previous.frames) / seconds) : undefined),
    width: numberValue(stat.frameWidth),
    height: numberValue(stat.frameHeight),
    targetBitrate: numberValue(stat.targetBitrate),
    qualityLimitationReason: stringValue(stat.qualityLimitationReason),
    qualityLimitationDurationMs: activeLimitationDurationMs(stat),
    framesDropped: numberValue(stat.framesDropped),
    codec: stringValue(stat.mimeType),
    decoder: stringValue(stat.decoderImplementation),
  }
}

function enrichNetworkMetrics(metric: StreamMetric, records: Array<Record<string, unknown>>): void {
  metric.roundTripTimeMs = milliseconds(firstNumber(records, 'roundTripTime'))
  metric.jitterMs = milliseconds(firstNumber(records, 'jitter'))
  const jitterBufferDelay = firstNumber(records, 'jitterBufferDelay')
  const jitterBufferEmitted = firstNumber(records, 'jitterBufferEmittedCount')
  if (jitterBufferDelay !== undefined && jitterBufferEmitted && jitterBufferEmitted > 0) {
    metric.jitterBufferDelayMs = (jitterBufferDelay / jitterBufferEmitted) * 1_000
  }
  const totalDecodeTime = firstNumber(records, 'totalDecodeTime')
  const framesDecoded = firstNumber(records, 'framesDecoded')
  if (totalDecodeTime !== undefined && framesDecoded && framesDecoded > 0) {
    metric.decodeTimeMs = (totalDecodeTime / framesDecoded) * 1_000
  }
}

function firstNumber(records: Array<Record<string, unknown>>, key: string): number | undefined {
  for (const record of records) {
    const value = record[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return undefined
}

function milliseconds(value: number | undefined): number | undefined { return value === undefined ? undefined : value * 1_000 }

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function activeLimitationDurationMs(stat: Record<string, unknown>): number | undefined {
  const reason = stringValue(stat.qualityLimitationReason)
  const durations = stat.qualityLimitationDurations
  if (!reason || reason === 'none' || !durations || typeof durations !== 'object') return undefined
  const seconds = (durations as Record<string, unknown>)[reason]
  return typeof seconds === 'number' && Number.isFinite(seconds) ? seconds * 1_000 : undefined
}


function dimensionsFor(quality: ShareQuality): { width: number; height: number } {
  if (quality.resolution === '480p') return { width: 854, height: 480 }
  if (quality.resolution === '720p') return { width: 1280, height: 720 }
  if (quality.resolution === '1080p') return { width: 1920, height: 1080 }
  return { width: 2560, height: 1440 }
}

function encodingPreferenceFor(priority: SharePriority): {
  contentHint: 'detail' | 'motion'
  degradationPreference: RTCDegradationPreference
} {
  return priority === 'framerate'
    ? { contentHint: 'motion', degradationPreference: 'maintain-framerate' }
    : { contentHint: 'detail', degradationPreference: 'maintain-resolution' }
}

function captureMessage(error: unknown): string {
  if (!(error instanceof Error)) return 'Screen share did not start'
  if (/notallowed|permission denied|permission/i.test(error.message)) return 'Screen capture was blocked. Choose a screen and try again.'
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
  return typeof name === 'string' ? name.replaceAll('_', ' ').toLowerCase() : 'lost connection'
}
