import type { MediaParticipant } from '../../shared/protocol'
import { shareBitrateFor, type SharePriority, type ShareQuality } from '../../shared/types'
import { MediaConnection, type RemoteTrack } from './media/connection'
import { closeSystemAudio, openSystemAudioTrack } from './system-audio'
import { RoomVoice, type VoiceSettings, type VoiceState } from './voice'
import { MAX_PLAYBACK_VOLUME, PlaybackGain, playbackGain } from './playback-volume'

export interface MediaTargets {
  video: HTMLVideoElement
  audioRack: HTMLElement
}

export interface RoomParticipant {
  id: string
  name: string
  local: boolean
}

export interface ScreenStream {
  id: string
  participantId: string
  participantName: string
  local: boolean
  muted: boolean
  /** A remote stream is only received after the viewer explicitly watches it. */
  subscribed: boolean
  viewers: RoomParticipant[]
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
  encoder?: string
  powerEfficientEncoder?: boolean
  encodeTimeMs?: number
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
  onVoice?: (state: VoiceState) => void
  /** Unexpected disconnects only; explicit leave never emits this. */
  onRoomLost?: () => void
  onConnection: (state: Presence) => void
  onViewers: (count: number) => void
  onParticipants: (participants: RoomParticipant[]) => void
  onStreams: (streams: ScreenStream[]) => void
  onTelemetry: (telemetry: StreamTelemetry) => void
  onAudioBlocked: (blocked: boolean) => void
  onError: (message: string) => void
}

interface RemoteAudioGraph {
  receiverElement: HTMLAudioElement
  source: MediaStreamAudioSourceNode
  gain: PlaybackGain
  destination: MediaStreamAudioDestinationNode
}

interface CounterSample {
  bytes: number
  packets: number
  packetsLost: number
  frames: number
  timestamp: number
}

let connection: MediaConnection | null = null
let voice: RoomVoice | null = null
let targets: MediaTargets | null = null
let hooks: SessionHooks | null = null
let voiceAudioBlocked = false
let screenAudioBlocked = false
let participants: MediaParticipant[] = []
let remoteTracks: RemoteTrack[] = []
let localScreen: MediaStreamTrack | null = null
let localScreenTargetBitrate: number | undefined
let localParticipantName: string | undefined
let selectedStreamId: string | null = null
let stageVideoVisible = true
const watching = new Set<string>()
const mutedParticipants = new Set<string>()
const remoteStreamVolumes = new Map<string, number>()
const remoteAudio = new Map<string, HTMLAudioElement>()
const remoteAudioTracks = new Map<string, MediaStreamTrack>()
const remoteAudioGraphs = new Map<string, RemoteAudioGraph>()
let gridTargets = new Map<string, HTMLVideoElement>()
let audioContext: AudioContext | null = null
let remoteAudioVolume = 1
let microphoneTestActive = false
let remoteAudioOutputDeviceId = ''
let statsTimer: ReturnType<typeof window.setInterval> | null = null
const lastStats = new Map<string, CounterSample>()
let telemetryInFlight = false
let telemetryEnabled = false
let viewerVisible = true
let voiceInputLevelReporting = false
const nameCollator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

function notifyAudioBlocked(): void {
  hooks?.onAudioBlocked(screenAudioBlocked || voiceAudioBlocked)
}

export async function configureVoice(settings: VoiceSettings): Promise<void> { await voice?.configure(settings) }
export function setVoiceInputVolume(volume: number): void { voice?.setInputVolume(volume) }
export async function setVoiceMuted(muted: boolean): Promise<void> { await voice?.setMuted(muted) }
export async function setVoiceDeafened(deafened: boolean): Promise<void> { await voice?.setDeafened(deafened) }
export function setVoiceParticipantMuted(id: string, muted: boolean): void { voice?.setParticipantMuted(id, muted) }
export function setVoiceParticipantVolume(id: string, volume: number): void { voice?.setParticipantVolume(id, volume) }
export function setViewerVisible(visible: boolean): void { viewerVisible = visible; voice?.setVisible(visible) }
export function setVoiceInputLevelReporting(enabled: boolean): void { voiceInputLevelReporting = enabled; voice?.setInputLevelReporting(enabled) }

/** Screen audio and voice share one playback context and audio thread. */
function playbackContext(): AudioContext {
  audioContext ??= new AudioContext({ sampleRate: 48000 })
  return audioContext
}

function closePlaybackContext(): void {
  const context = audioContext
  audioContext = null
  if (context) void context.close().catch(() => undefined)
}

export async function joinRoom(args: {
  channelId: string
  media: MediaTargets
  hooks: SessionHooks
  voice: VoiceSettings
  name: string
}): Promise<void> {
  await leaveRoom()
  targets = args.media
  hooks = args.hooks
  localParticipantName = args.name
  hooks.onConnection('connecting')
  const next: MediaConnection = new MediaConnection({
    onParticipants: (list) => {
      if (connection !== next) return
      participants = list
      for (const id of [...watching]) if (!list.some(p => p.user_id === id && p.sharing)) watching.delete(id)
      voice?.setParticipants(list)
      emitParticipants()
      refreshStreams()
    },
    onTracks: (tracks) => {
      if (connection !== next) return
      remoteTracks = tracks
      voice?.setTracks(tracks)
      refreshStreams()
    },
    onClosed: (reason) => {
      if (connection !== next) return
      connection = null
      hooks?.onConnection('offline')
      hooks?.onRoomLost?.()
      hooks?.onError(reason)
      clearMedia()
    },
  })
  connection = next
  voice = new RoomVoice(next, args.media.audioRack, args.voice,
    state => { if (connection === next) hooks?.onVoice?.(state) },
    blocked => { voiceAudioBlocked = blocked; notifyAudioBlocked() },
    playbackContext)
  voice.setVisible(viewerVisible)
  voice.setInputLevelReporting(voiceInputLevelReporting)
  try {
    await voice.setOutputDevice(remoteAudioOutputDeviceId || 'default')
    voice.setOutputVolume(remoteAudioVolume)
    await voice.setTesting(microphoneTestActive)
    await next.open(args.channelId)
    if (connection !== next) throw new Error('The voice connection closed.')
    await voice.start()
  } catch (error) {
    if (connection === next) connection = null
    next.close()
    clearMedia()
    throw error instanceof Error ? error : new Error('Could not connect')
  }
  hooks.onConnection('connected')
  emitParticipants()
  refreshStreams()
  startTelemetry()
}

export async function leaveRoom(): Promise<void> {
  const current = connection
  connection = null
  await closeSystemAudio().catch(() => undefined)
  current?.close()
  clearMedia()
}

function requireConnection(): MediaConnection {
  if (!connection) throw new Error('Not connected')
  return connection
}

export async function publishScreen(withAudio: boolean, excludeDiscord: boolean, quality: ShareQuality): Promise<void> {
  const current = requireConnection()
  const dimensions = dimensionsFor(quality)
  const preference = encodingPreferenceFor(quality.priority)
  let video: MediaStreamTrack | null = null
  let protectedAudio: MediaStreamTrack | null = null
  try {
    // The main process picks the source the user selected (see capture.ts).
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: { max: dimensions.width }, height: { max: dimensions.height }, frameRate: { ideal: quality.frameRate, max: quality.frameRate } },
      audio: false,
    })
    video = stream.getVideoTracks()[0] ?? null
    if (!video || video.readyState !== 'live') throw new Error('Screen share did not start. Choose a screen and try again.')
    video.contentHint = preference.contentHint
    // Chromium loopback is already mixed. Send the protected WASAPI process-loopback
    // track instead, so this app's own audio cannot feed back.
    if (withAudio) protectedAudio = await openSystemAudioTrack(excludeDiscord)
    await current.startScreen(video, protectedAudio, {
      maxBitrate: shareBitrateFor(quality),
      maxFramerate: quality.frameRate,
      degradationPreference: preference.degradationPreference,
    })
    if (connection !== current || video.readyState !== 'live') throw new Error('The shared screen or window closed before sharing started.')
    localScreen = video
    localScreenTargetBitrate = shareBitrateFor(quality)
    const shared = video
    shared.addEventListener('ended', () => {
      if (localScreen !== shared) return
      void unpublishScreen().then(() => window.sharescreen?.setSharing(false)).catch(() => undefined)
    })
    refreshStreams()
  } catch (error) {
    localScreen = null
    localScreenTargetBitrate = undefined
    video?.stop()
    await Promise.all([closeSystemAudio(), current.stopScreen().catch(() => undefined)])
    throw new Error(captureMessage(error))
  }
}

export async function unpublishScreen(): Promise<void> {
  const current = connection
  localScreen = null
  localScreenTargetBitrate = undefined
  try {
    await Promise.all([closeSystemAudio(), current?.stopScreen()])
  } finally {
    refreshStreams()
  }
}

/** The name shown for this user. Other users see the name from the voice ticket. */
export async function updateDisplayName(name: string): Promise<void> {
  localParticipantName = name
  emitParticipants()
  refreshStreams()
}

function userOf(streamId: string): string | null {
  const match = /^(?:local|remote):(\d+)$/.exec(streamId)
  return match ? match[1] : null
}

export function selectStream(id: string | null): void {
  selectedStreamId = id
  attachSelectedVideo()
}

/** Starts receiving one screen (and its screen audio) on demand. */
export function watchStream(id: string): void {
  const user = userOf(id)
  selectedStreamId = id
  if (user && id.startsWith('remote:') && !watching.has(user)) {
    watching.add(user)
    connection?.watch(user, true)
  }
  refreshStreams()
}

/** Stops receiving a remote screen completely: no network, decode or audio work. */
export function hideStream(id: string): void {
  const user = userOf(id)
  if (!user || !id.startsWith('remote:')) return
  if (watching.delete(user)) connection?.watch(user, false)
  removeRemoteAudio(user)
  if (selectedStreamId === id) selectedStreamId = null
  refreshStreams()
}

/** Stops decoding the hidden single-stage preview while the grid is active. */
export function setStageVideoVisible(visible: boolean): void {
  if (stageVideoVisible === visible) return
  stageVideoVisible = visible
  attachSelectedVideo()
}

/** Attach every visible screen to the supplied grid video elements. */
export function setGridVideos(next: Map<string, HTMLVideoElement>): void {
  for (const [id, element] of gridTargets) if (next.get(id) !== element) detach(element)
  gridTargets = next
  syncGridVideos()
}

export function setStreamMuted(id: string, muted: boolean): void {
  const user = userOf(id)
  if (!user || !id.startsWith('remote:')) return
  if (muted) mutedParticipants.add(user)
  else mutedParticipants.delete(user)
  const element = remoteAudio.get(user)
  if (element) {
    element.muted = muted
    applyAudioVolume(user)
  }
  refreshStreams()
}

/** Applies a relative volume to one remote screen-audio track. */
export function setStreamVolume(id: string, volume: number): void {
  const user = userOf(id)
  if (!user || !id.startsWith('remote:')) return
  remoteStreamVolumes.set(user, Math.max(0, Math.min(MAX_PLAYBACK_VOLUME, volume)))
  applyAudioVolume(user)
}

/** Applies a single playback level to incoming screen and voice audio. */
export function setRemoteAudioVolume(volume: number): void {
  remoteAudioVolume = Math.max(0, Math.min(MAX_PLAYBACK_VOLUME, volume))
  voice?.setOutputVolume(remoteAudioVolume)
  for (const user of remoteAudio.keys()) applyAudioVolume(user)
}

/** Silence voice capture and all incoming audio while a local microphone test plays. */
export async function setMicrophoneTestActive(active: boolean): Promise<void> {
  microphoneTestActive = active
  for (const user of remoteAudio.keys()) applyAudioVolume(user)
  await voice?.setTesting(active)
}

/** Routes remote audio to a Windows output device when Chromium supports it. */
export async function setRemoteAudioOutputDevice(deviceId: string): Promise<void> {
  const previous = remoteAudioOutputDeviceId
  remoteAudioOutputDeviceId = deviceId
  try {
    await Promise.all([voice?.setOutputDevice(deviceId), ...[...remoteAudio.values()].map((element) => setSinkId(element, deviceId))])
  } catch (error) {
    remoteAudioOutputDeviceId = previous
    await Promise.allSettled([voice?.setOutputDevice(previous || 'default'), ...[...remoteAudio.values()].map((element) => setSinkId(element, previous))])
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
      voice?.resume(),
      audioContext?.resume(),
      ...[...remoteAudioGraphs.values()].map(({ receiverElement }) => receiverElement.play()),
      ...[...remoteAudio.values()].map((element) => element.play()),
    ])
    screenAudioBlocked = false
  } catch {
    screenAudioBlocked = true
  }
  notifyAudioBlocked()
}

// ---- Participants and streams ----

function localUser(): string {
  return connection?.userId ?? ''
}

function displayName(participant: MediaParticipant): string {
  return participant.user_id === localUser() && localParticipantName ? localParticipantName : participant.display_name
}

function emitParticipants(): void {
  const list: RoomParticipant[] = participants.map(p => ({ id: p.user_id, name: displayName(p), local: p.user_id === localUser() }))
  if (connection && !list.some(p => p.local)) list.push({ id: localUser(), name: localParticipantName || 'You', local: true })
  hooks?.onParticipants(list.sort((a, b) => nameCollator.compare(a.name, b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)))
  hooks?.onViewers(Math.max(0, list.length - 1))
}

function screenTrack(user: string): MediaStreamTrack | undefined {
  if (user === localUser()) return localScreen ?? undefined
  return remoteTracks.find(t => t.userId === user && t.source === 'screen')?.track
}

function currentStreams(): ScreenStream[] {
  const me = localUser()
  const people = new Map(participants.map(p => [p.user_id, p]))
  const result: ScreenStream[] = []
  const viewersOf = (user: string): RoomParticipant[] => participants
    .filter(p => p.user_id !== user && p.watching.includes(user))
    .map(p => ({ id: p.user_id, name: displayName(p), local: p.user_id === me }))
    .sort((a, b) => nameCollator.compare(a.name, b.name) || a.id.localeCompare(b.id))
  if (localScreen && me) {
    result.push({ id: `local:${me}`, participantId: me, participantName: localParticipantName || 'You', local: true, muted: false, subscribed: true, viewers: viewersOf(me) })
  }
  for (const participant of participants) {
    if (participant.user_id === me || !participant.sharing) continue
    const user = participant.user_id
    result.push({
      id: `remote:${user}`, participantId: user, participantName: people.get(user)?.display_name ?? user, local: false,
      muted: mutedParticipants.has(user), subscribed: watching.has(user), viewers: viewersOf(user),
    })
  }
  return result
}

function refreshStreams(): void {
  const streams = currentStreams()
  if (selectedStreamId && !streams.some(s => s.id === selectedStreamId)) selectedStreamId = null
  syncRemoteAudio()
  attachSelectedVideo()
  syncGridVideos()
  if (connection) hooks?.onStreams(streams)
}

function attach(element: HTMLVideoElement, track: MediaStreamTrack | undefined, local: boolean): void {
  const current = element.srcObject instanceof MediaStream ? element.srcObject.getVideoTracks()[0] : undefined
  if (current === track && track) return
  if (!track) { detach(element); return }
  element.muted = local
  element.srcObject = new MediaStream([track])
  void element.play().catch(() => undefined)
}

function detach(element: HTMLVideoElement): void {
  element.pause()
  element.srcObject = null
}

function attachSelectedVideo(): void {
  const media = targets
  if (!media) return
  const user = selectedStreamId ? userOf(selectedStreamId) : null
  const visible = stageVideoVisible && user && (selectedStreamId?.startsWith('local:') || watching.has(user))
  attach(media.video, visible && user ? screenTrack(user) : undefined, selectedStreamId?.startsWith('local:') ?? false)
}

function syncGridVideos(): void {
  for (const [id, element] of gridTargets) {
    const user = userOf(id)
    const local = id.startsWith('local:')
    attach(element, user && (local || watching.has(user)) ? screenTrack(user) : undefined, local)
  }
}

function syncRemoteAudio(): void {
  const wanted = new Map<string, MediaStreamTrack>()
  for (const track of remoteTracks) {
    if (track.source === 'screen_audio' && watching.has(track.userId)) wanted.set(track.userId, track.track)
  }
  for (const user of [...remoteAudio.keys()]) if (!wanted.has(user)) removeRemoteAudio(user)
  for (const [user, track] of wanted) void attachAudio(user, track)
}

async function attachAudio(user: string, track: MediaStreamTrack): Promise<void> {
  const media = targets
  if (!media) return
  let element = remoteAudio.get(user)
  if (!element) {
    element = document.createElement('audio')
    element.autoplay = true
    media.audioRack.append(element)
    remoteAudio.set(user, element)
  }
  try {
    if (remoteAudioTracks.get(user) !== track) {
      disconnectRemoteAudioGraph(user)
      const context = playbackContext()
      // Process the received track with Web Audio, then play only the processed
      // stream through the element so mute and setSinkId control the audible path.
      const stream = new MediaStream([track])
      // Keep Chromium's receiver pulling audio while only Web Audio consumes it.
      const receiverElement = document.createElement('audio')
      receiverElement.muted = true
      receiverElement.volume = 0
      receiverElement.srcObject = stream
      const source = context.createMediaStreamSource(stream)
      const destination = context.createMediaStreamDestination()
      const gain = new PlaybackGain(context, destination)
      source.connect(gain.node)
      remoteAudioGraphs.set(user, { receiverElement, source, gain, destination })
      element.srcObject = destination.stream
      remoteAudioTracks.set(user, track)
    }
    applyAudioVolume(user)
    element.muted = mutedParticipants.has(user)
    await Promise.all([audioContext?.resume(), remoteAudioGraphs.get(user)?.receiverElement.play()])
    if (remoteAudio.get(user) !== element) return
    await setSinkId(element, remoteAudioOutputDeviceId)
    if (remoteAudio.get(user) !== element) return
    await element.play()
    screenAudioBlocked = false
  } catch {
    if (remoteAudio.get(user) === element) screenAudioBlocked = true
  }
  notifyAudioBlocked()
}

function removeRemoteAudio(user: string): void {
  disconnectRemoteAudioGraph(user)
  const element = remoteAudio.get(user)
  if (element) {
    element.pause()
    element.srcObject = null
    element.remove()
  }
  remoteAudio.delete(user)
  remoteAudioTracks.delete(user)
}

function applyAudioVolume(user: string): void {
  const volume = microphoneTestActive || mutedParticipants.has(user) ? 0 : playbackGain(remoteAudioVolume) * playbackGain(remoteStreamVolumes.get(user) ?? 1)
  remoteAudioGraphs.get(user)?.gain.set(volume)
}

function disconnectRemoteAudioGraph(user: string): void {
  const graph = remoteAudioGraphs.get(user)
  if (!graph) return
  graph.receiverElement.pause()
  graph.receiverElement.srcObject = null
  graph.source.disconnect()
  graph.gain.disconnect()
  graph.destination.stream.getTracks().forEach((track) => track.stop())
  remoteAudioGraphs.delete(user)
}

function setSinkId(element: HTMLAudioElement, deviceId: string): Promise<void> {
  const sinkable = element as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }
  if (!sinkable.setSinkId) return Promise.resolve()
  return sinkable.setSinkId(deviceId)
}

function clearMedia(): void {
  voice?.close()
  voice = null
  voiceAudioBlocked = false
  screenAudioBlocked = false
  stopTelemetry()
  localScreen?.stop()
  localScreen = null
  localScreenTargetBitrate = undefined
  if (targets) detach(targets.video)
  for (const element of gridTargets.values()) detach(element)
  gridTargets.clear()
  participants = []
  remoteTracks = []
  selectedStreamId = null
  stageVideoVisible = true
  watching.clear()
  mutedParticipants.clear()
  for (const user of [...remoteAudio.keys()]) removeRemoteAudio(user)
  closePlaybackContext()
  remoteStreamVolumes.clear()
  localParticipantName = undefined
  hooks?.onStreams([])
  hooks?.onParticipants([])
  hooks?.onTelemetry({})
  hooks?.onAudioBlocked(false)
}

// ---- Statistics ----

function startTelemetry(): void {
  stopTelemetry()
  if (!telemetryEnabled || !connection) return
  const current = connection
  const collect = (): void => {
    if (connection !== current || telemetryInFlight || !viewerVisible || document.hidden) return
    telemetryInFlight = true
    void collectTelemetry(current).catch(() => undefined).finally(() => { telemetryInFlight = false })
  }
  collect()
  statsTimer = window.setInterval(collect, 1000)
}

export function setTelemetryEnabled(enabled: boolean): void {
  telemetryEnabled = enabled
  if (!enabled) stopTelemetry()
  else if (connection) startTelemetry()
}

function stopTelemetry(): void {
  if (statsTimer !== null) window.clearInterval(statsTimer)
  statsTimer = null
  telemetryInFlight = false
  lastStats.clear()
}

async function collectTelemetry(current: MediaConnection): Promise<void> {
  const telemetry: StreamTelemetry = {}
  const sender = current.screenSender
  if (sender && localScreen) {
    const report = await sender.getStats().catch(() => undefined)
    const records = report ? Array.from(report.values()) as Array<Record<string, unknown>> : []
    const senderStats = records.filter(stat => stat.type === 'outbound-rtp' && (stat.kind === 'video' || stat.mediaType === 'video'))
    const primary = senderStats.reduce<Record<string, unknown> | undefined>((largest, stat) => numberValue(stat.bytesSent) > numberValue(largest?.bytesSent) ? stat : largest, senderStats[0])
    if (primary) {
      const metric = toMetric('sent', primary)
      const remote = records.find(stat => stat.id === primary.remoteId)
      enrichNetworkMetrics(metric, [primary, ...(remote ? [remote] : [])])
      metric.codec = stringValue(records.find(stat => stat.id === primary.codecId)?.mimeType)
      metric.encoder = stringValue(primary.encoderImplementation)
      if (typeof primary.powerEfficientEncoder === 'boolean') metric.powerEfficientEncoder = primary.powerEfficientEncoder
      if (typeof primary.totalEncodeTime === 'number' && numberValue(primary.framesEncoded) > 0) metric.encodeTimeMs = primary.totalEncodeTime / numberValue(primary.framesEncoded) * 1_000
      metric.maxBitrate = localScreenTargetBitrate
      const settings = localScreen.getSettings()
      metric.captureWidth = numberValue(settings.width)
      metric.captureHeight = numberValue(settings.height)
      metric.captureFrameRate = numberValue(settings.frameRate)
      telemetry.sent = metric
    }
  }
  const user = selectedStreamId?.startsWith('remote:') ? userOf(selectedStreamId) : null
  const receiver = user ? remoteTracks.find(t => t.userId === user && t.source === 'screen')?.receiver : undefined
  if (receiver && selectedStreamId) {
    const report = await receiver.getStats().catch(() => undefined)
    const records = report ? Array.from(report.values()) as Array<Record<string, unknown>> : []
    const stats = records.find(stat => stat.type === 'inbound-rtp' && (stat.kind === 'video' || stat.mediaType === 'video'))
    if (stats) {
      const metric = toMetric(`received:${selectedStreamId}`, stats)
      enrichNetworkMetrics(metric, [stats])
      metric.codec = stringValue(records.find(stat => stat.id === stats.codecId)?.mimeType)
      telemetry.received = metric
    }
  }
  if (connection === current) hooks?.onTelemetry(telemetry)
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
  return { width: 1920, height: 1080 }
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
