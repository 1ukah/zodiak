// Deterministic session adapter for UI checks. No server or screen capture is used.
let hooks
let streams = []
export const state = window.uiTest = {
  hooks: null, volume: 1, streamVolume: 1, device: 'default', selected: null, targets: [],
  sentMessages: [], failChat: false,
  voice: { enabled: true, muted: true, deafened: false, busy: false, participants: [] }, voiceDevice: 'default', inputVolume: 1, noiseSuppression: false, suppressionStrength:.8,
  emitVoice(value) { Object.assign(state.voice, value); state.voice.participants=state.voice.participants.map(person=>person.id==='me'?{...person,enabled:state.voice.enabled,muted:state.voice.muted,deafened:state.voice.deafened,speaking:false}:person); hooks.onVoice?.(state.voice) },
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
  state.voice = { enabled: options.voice?.enabled !== false, muted: true, deafened: false, busy: false, participants: [
    { id: 'me', enabled: true, muted: true, deafened: false, locallyMuted: false, speaking: false },
    { id: 'sam', enabled: true, muted: false, deafened: false, locallyMuted: false, speaking: false },
    { id: 'jo', enabled: true, muted: true, deafened: true, locallyMuted: false, speaking: false },
  ] }
  state.voice.participants = state.voice.participants.map(person => ({...person,volume:options.voice?.participantVolumes?.[person.id] ?? 1}))
  state.noiseSuppression = options.voice?.noiseSuppression === true
  state.emitVoice({})
  if (state.holdJoin) await new Promise(resolve => { state.releaseHeldJoin = resolve })
  state.joinInFlight = false
  if (state.failJoin) throw new Error('Test connection failed')
}
export async function leaveRoom() { streams = []; hooks?.onStreams([]); hooks?.onParticipants([]); hooks?.onConnection('offline') }
export function setVoiceInputVolume(volume) { state.inputVolume = volume }
export async function configureVoice(settings) { state.processing={...state.processing,...settings}; state.inputVolume = settings.inputVolume ?? state.inputVolume; state.voiceDevice = settings.inputDeviceId; state.noiseSuppression = settings.noiseSuppression === true; state.suppressionStrength=settings.suppressionStrength??state.suppressionStrength; state.emitVoice({ enabled: settings.enabled }) }
export async function setVoiceMuted(muted) { state.emitVoice({ muted, ...(!muted ? { deafened: false } : {}) }) }
let microphoneTesting=false, previousVoice, incomingVolume=1
export async function setMicrophoneTestActive(active) {
  if(microphoneTesting===active)return
  microphoneTesting=active
  if(active){previousVoice={muted:state.voice.muted,deafened:state.voice.deafened};state.emitVoice({muted:true,deafened:true})}
  else if(previousVoice){state.emitVoice(previousVoice);previousVoice=null}
  state.volume=active?0:incomingVolume
}
let beforeDeafen = true
export async function setVoiceDeafened(deafened) {
  if (deafened) beforeDeafen = state.voice.muted
  state.emitVoice({ deafened, muted: deafened || beforeDeafen })
}
export function setVoiceParticipantMuted(id, muted) {
  state.voice.participants = state.voice.participants.map(person => person.id === id ? { ...person, locallyMuted: muted, speaking: muted ? false : person.speaking } : person)
  state.emitVoice({})
}
export function setVoiceParticipantVolume(id, volume) {
  state.voice.participants = state.voice.participants.map(person => person.id === id ? { ...person, volume, speaking: volume === 0 ? false : person.speaking } : person)
  state.emitVoice({})
}
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
export function setRemoteAudioVolume(volume) { incomingVolume=volume;state.volume=microphoneTesting?0:volume }
export async function resumeRemoteAudio() { hooks?.onAudioBlocked(false) }
export function setStreamVolume(id, volume) { state.streamVolume = volume }
export function setStageVideoVisible() {}
export function setStreamMuted(id, muted) { state.emitStreams(streams.map(s => s.id === id ? { ...s, muted } : s)) }
export function supportsRemoteAudioOutputSelection() { return true }
export function setTelemetryEnabled() {}
export function setViewerVisible() {}
export async function sendChatMessage(text, recipient, images = []) {
  if (state.failChat) throw new Error('Test send failed')
  const message = { version: 1, id: crypto.randomUUID(), text, timestamp: Date.now(), senderId: 'me', senderName: 'Alex Morgan', local: true, ...(recipient ? { recipient } : {}), ...(images.length ? { images: images.map(image => ({ name: image.name, mimeType: image.type, size: image.size, blob: image })) } : {}) }
  state.sentMessages.push(message)
  return message
}
