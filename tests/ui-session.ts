// Deterministic session adapter for UI checks. No server or screen capture is used.
let hooks
let streams = []
export const state = window.uiTest = {
  hooks: null, volume: 1, streamVolume: 1, device: 'default', selected: null, targets: [],
  emitStreams(value) { streams = value; hooks.onStreams(value) },
  emitTelemetry(value) { hooks.onTelemetry(value) },
}
export async function joinRoom(options) {
  hooks = options.hooks; state.hooks = hooks
  hooks.onConnection('connected'); hooks.onViewers(2)
  hooks.onParticipants([{ id: 'me', name: 'Alex Morgan', local: true }, { id: 'sam', name: 'Sam Rivera', local: false }, { id: 'jo', name: 'Jordan Lee', local: false }])
  hooks.onStreams([])
}
export async function leaveRoom() { streams = []; hooks?.onStreams([]); hooks?.onParticipants([]); hooks?.onConnection('offline') }
export async function publishScreen() { state.emitStreams([{ id: 'local', participantId: 'me', participantName: 'Alex Morgan', local: true, muted: false }]) }
export async function unpublishScreen() { state.emitStreams(streams.filter(s => !s.local)) }
export function selectStream(id) { state.selected = id }
export function setGridVideos(targets) { state.targets = [...targets.keys()] }
export function setRemoteAudioOutputDevice(id) { state.device = id; return Promise.resolve() }
export function setRemoteAudioVolume(volume) { state.volume = volume }
export function setStreamVolume(id, volume) { state.streamVolume = volume }
export function setStageVideoVisible() {}
export function setStreamMuted(id, muted) { state.emitStreams(streams.map(s => s.id === id ? { ...s, muted } : s)) }
export function supportsRemoteAudioOutputSelection() { return true }
