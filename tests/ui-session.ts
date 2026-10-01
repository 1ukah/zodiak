// Deterministic session adapter for UI checks. No server or screen capture is used.
let hooks
let streams = []
export const state = window.uiTest = {
  hooks: null, volume: 1, streamVolume: 1, device: 'default', selected: null, targets: [],
  sentMessages: [], failChat: false,
  holdJoin: false, joinInFlight: false, failJoin: false, releaseHeldJoin: null,
  finishJoin() { state.holdJoin = false; state.releaseHeldJoin?.(); state.releaseHeldJoin = null },
  emitChat(value) { hooks.onChatMessage({ version: 1, id: crypto.randomUUID(), text: 'Hello', timestamp: Date.now(), senderId: 'sam', senderName: 'Sam Rivera', local: false, ...value }) },
  emitStreams(value) { streams = value; hooks.onStreams(value) },
  emitParticipants(value) { hooks.onParticipants(value) },
  emitTelemetry(value) { hooks.onTelemetry(value) },
}
export async function joinRoom(options) {
  hooks = options.hooks; state.hooks = hooks
  state.joinInFlight = true
  hooks.onConnection('connecting')
  hooks.onConnection('connected'); hooks.onViewers(2)
  hooks.onParticipants([{ id: 'me', name: 'Alex Morgan', local: true }, { id: 'sam', name: 'Sam Rivera', local: false }, { id: 'jo', name: 'Jordan Lee', local: false }])
  hooks.onStreams([])
  if (state.holdJoin) await new Promise(resolve => { state.releaseHeldJoin = resolve })
  state.joinInFlight = false
  if (state.failJoin) throw new Error('Test connection failed')
}
export async function leaveRoom() { streams = []; hooks?.onStreams([]); hooks?.onParticipants([]); hooks?.onConnection('offline') }
export async function publishScreen(_withAudio, _excludeDiscord, quality) { state.quality = quality; state.emitStreams([{ id: 'local', participantId: 'me', participantName: 'Alex Morgan', local: true, muted: false }]) }
export async function unpublishScreen() { state.emitStreams(streams.filter(s => !s.local)) }
export async function updateDisplayName(name) {
  hooks.onParticipants([{ id: 'me', name, local: true }, { id: 'sam', name: 'Sam Rivera', local: false }, { id: 'jo', name: 'Jordan Lee', local: false }])
  state.emitStreams(streams.map(stream => stream.local ? { ...stream, participantName: name } : stream))
}
export function selectStream(id) { state.selected = id }
export function watchStream(id) { state.selected = id; state.emitStreams(streams.map(s => s.id === id ? { ...s, subscribed: true } : s)) }
export function hideStream(id) { state.emitStreams(streams.map(s => s.id === id ? { ...s, subscribed: false } : s)) }
export function setGridVideos(targets) { state.targets = [...targets.keys()] }
export function setRemoteAudioOutputDevice(id) { state.device = id; return Promise.resolve() }
export function setRemoteAudioVolume(volume) { state.volume = volume }
export async function resumeRemoteAudio() { hooks?.onAudioBlocked(false) }
export function setStreamVolume(id, volume) { state.streamVolume = volume }
export function setStageVideoVisible() {}
export function setStreamMuted(id, muted) { state.emitStreams(streams.map(s => s.id === id ? { ...s, muted } : s)) }
export function supportsRemoteAudioOutputSelection() { return true }
export async function sendChatMessage(text, recipient) {
  if (state.failChat) throw new Error('Test send failed')
  const message = { version: 1, id: crypto.randomUUID(), text, timestamp: Date.now(), senderId: 'me', senderName: 'Alex Morgan', local: true, ...(recipient ? { recipient } : {}) }
  state.sentMessages.push(message)
  return message
}
