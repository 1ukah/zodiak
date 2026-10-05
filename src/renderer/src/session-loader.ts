// The lobby needs no WebRTC engine. Load it only when joining a room, retaining
// settings selected before the first connection and sharing one import promise.
import type * as Session from './session'
export type { Presence, RoomParticipant, ScreenStream, SessionHooks, StreamMetric, StreamTelemetry } from './session'
type Engine = typeof Session
let engine: Engine | undefined
let loading: Promise<Engine> | undefined
let volume = 1
let deviceId = 'default'
let statistics = false
let viewerVisible = true
let microphoneTestActive = false

function load(): Promise<Engine> {
  loading ??= import('./session').then(async module => {
    module.setRemoteAudioVolume(volume)
    module.setTelemetryEnabled(statistics)
    module.setViewerVisible(viewerVisible)
    await module.setRemoteAudioOutputDevice(deviceId)
    engine = module
    await module.setMicrophoneTestActive(microphoneTestActive)
    return module
  }).catch(error => { loading = undefined; throw error })
  return loading
}
function active(): Engine {
  if (!engine) throw new Error('Join a room first')
  return engine
}
export async function joinRoom(...args: Parameters<Engine['joinRoom']>) { await (await load()).joinRoom(...args) }
export async function leaveRoom() { await engine?.leaveRoom() }
export async function publishScreen(...args: Parameters<Engine['publishScreen']>) { await active().publishScreen(...args) }
export async function unpublishScreen() { await engine?.unpublishScreen() }
export async function updateDisplayName(...args: Parameters<Engine['updateDisplayName']>) { await active().updateDisplayName(...args) }
export async function sendChatMessage(...args: Parameters<Engine['sendChatMessage']>) { return active().sendChatMessage(...args) }
export async function resumeRemoteAudio() { await engine?.resumeRemoteAudio() }
export async function configureVoice(...args: Parameters<Engine['configureVoice']>) { await engine?.configureVoice(...args) }
export async function setVoiceMuted(...args: Parameters<Engine['setVoiceMuted']>) { await engine?.setVoiceMuted(...args) }
export async function setVoiceDeafened(...args: Parameters<Engine['setVoiceDeafened']>) { await engine?.setVoiceDeafened(...args) }
export async function setMicrophoneTestActive(active: boolean) { microphoneTestActive = active; await engine?.setMicrophoneTestActive(active) }
export function setVoiceInputVolume(...args: Parameters<Engine['setVoiceInputVolume']>) { engine?.setVoiceInputVolume(...args) }
export function setVoiceParticipantMuted(...args: Parameters<Engine['setVoiceParticipantMuted']>) { engine?.setVoiceParticipantMuted(...args) }
export function setVoiceParticipantVolume(...args: Parameters<Engine['setVoiceParticipantVolume']>) { engine?.setVoiceParticipantVolume(...args) }
export function selectStream(...args: Parameters<Engine['selectStream']>) { engine?.selectStream(...args) }
export function watchStream(...args: Parameters<Engine['watchStream']>) { engine?.watchStream(...args) }
export function hideStream(...args: Parameters<Engine['hideStream']>) { engine?.hideStream(...args) }
export function setGridVideos(...args: Parameters<Engine['setGridVideos']>) { engine?.setGridVideos(...args) }
export function setStageVideoVisible(...args: Parameters<Engine['setStageVideoVisible']>) { engine?.setStageVideoVisible(...args) }
export function setStreamMuted(...args: Parameters<Engine['setStreamMuted']>) { engine?.setStreamMuted(...args) }
export function setStreamVolume(...args: Parameters<Engine['setStreamVolume']>) { engine?.setStreamVolume(...args) }
export function setRemoteAudioVolume(value: number) { volume = value; engine?.setRemoteAudioVolume(value) }
export function setTelemetryEnabled(value: boolean) { statistics = value; engine?.setTelemetryEnabled(value) }
export function setViewerVisible(value: boolean) { viewerVisible = value; engine?.setViewerVisible(value) }
export async function setRemoteAudioOutputDevice(value: string) {
  await engine?.setRemoteAudioOutputDevice(value)
  deviceId = value
}
export function supportsRemoteAudioOutputSelection() {
  return typeof HTMLMediaElement.prototype.setSinkId === 'function'
}
