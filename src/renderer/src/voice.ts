import type { MediaParticipant } from '../../shared/protocol'
import type { MediaConnection, RemoteTrack } from './media/connection'
import { MicrophoneProcessor } from './microphone-processor'
import type { NoiseGateSettings, InputLevel } from './noise-gate'
import { voiceActiveUntil } from './voice-activity'
import { MAX_PLAYBACK_VOLUME, PlaybackGain, playbackGain } from './playback-volume'

export interface VoiceParticipant {
  id: string
  enabled: boolean
  muted: boolean
  deafened: boolean
  locallyMuted: boolean
  volume: number
  speaking: boolean
}

export interface VoiceState {
  enabled: boolean
  muted: boolean
  deafened: boolean
  busy: boolean
  participants: VoiceParticipant[]
  inputLevel?: InputLevel
}

export interface VoiceSettings extends NoiseGateSettings { enabled: boolean; inputDeviceId: string; inputVolume?: number; noiseSuppression?: boolean; suppressionStrength?: number; echoCancellation?: boolean; autoGainControl?: boolean; participantVolumes?: Record<string, number> }

interface VoicePlayback {
  track: MediaStreamTrack
  element: HTMLAudioElement
  receiver: HTMLAudioElement
  source: MediaStreamAudioSourceNode
  gain: PlaybackGain
  destination: MediaStreamAudioDestinationNode
}

interface Meter {
  track: MediaStreamTrack
  source: GainNode
  analyser: AnalyserNode
  samples: Float32Array<ArrayBuffer>
  activeUntil: number
}

interface Capture {
  stream: MediaStream
  processor: MicrophoneProcessor
}

/** Voice for one voice channel: microphone capture and sending, and playback of the others. */
export class RoomVoice {
  private enabled: boolean
  private inputDeviceId: string
  private muted = true
  private deafened = false
  private testing = false
  private pending = 0
  private closed = false
  private queue: Promise<void> = Promise.resolve()
  private outputDeviceId = 'default'
  private outputVolume = 1
  private inputVolume: number
  private noiseSuppression: boolean
  private suppressionStrength: number
  private echoCancellation: boolean
  private autoGainControl: boolean
  private gateSettings: NoiseGateSettings
  private inputContext: AudioContext | null = null
  private capture: Capture | null = null
  private remote = new Map<string, MediaParticipant>()
  private remoteMicrophones = new Map<string, MediaStreamTrack>()
  private audio = new Map<string, VoicePlayback>()
  private mutedIds = new Set<string>()
  private participantVolumes = new Map<string, number>()
  private meters = new Map<string, Meter>()
  private localActiveUntil = 0
  private context: AudioContext | null = null
  private timer: number | null = null
  private visible = true
  private reportInputLevel = false
  private signature = ''

  /** `playbackContext` lets the session share one output graph (and audio thread) with screen audio. */
  constructor(private connection: MediaConnection, private rack: HTMLElement, settings: VoiceSettings,
    private onState: (state: VoiceState) => void, private onBlocked: (blocked: boolean) => void,
    private playbackContext?: () => AudioContext) {
    this.enabled = settings.enabled
    this.inputDeviceId = settings.inputDeviceId
    this.inputVolume = Math.max(0, Math.min(1, settings.inputVolume ?? 1))
    this.noiseSuppression = settings.noiseSuppression !== false
    this.suppressionStrength = settings.suppressionStrength ?? .8
    this.echoCancellation = settings.echoCancellation !== false
    this.autoGainControl = settings.autoGainControl === true
    this.gateSettings = { noiseGate: settings.noiseGate !== false, autoInputSensitivity: settings.autoInputSensitivity !== false, inputSensitivity: settings.inputSensitivity ?? -50 }
    for (const [id, volume] of Object.entries(settings.participantVolumes ?? {})) {
      if (Number.isFinite(volume)) this.participantVolumes.set(id, Math.max(0, Math.min(MAX_PLAYBACK_VOLUME, volume)))
    }
    this.startMeters()
  }

  async start(): Promise<void> { await this.run(() => this.reconcile()) }

  /** Participants from the media server, including this user. */
  setParticipants(participants: MediaParticipant[]): void {
    this.remote = new Map(participants.filter(p => p.user_id !== this.connection.userId).map(p => [p.user_id, p]))
    for (const id of this.mutedIds) if (!this.remote.has(id)) this.mutedIds.delete(id)
    this.sync()
  }

  setTracks(tracks: RemoteTrack[]): void {
    this.remoteMicrophones = new Map(tracks.filter(t => t.source === 'microphone').map(t => [t.userId, t.track]))
    this.sync()
  }

  /** Speaking indicators are not visible while minimized; stop polling the analysers. */
  setVisible(visible: boolean): void {
    if (this.visible === visible || this.closed) return
    this.visible = visible
    if (visible) { this.startMeters(); this.emit() }
    else this.stopMeters()
  }

  /** The live input level is only shown in settings; omit it otherwise so it cannot re-render the room UI. */
  setInputLevelReporting(enabled: boolean): void {
    if (this.reportInputLevel === enabled) return
    this.reportInputLevel = enabled
    this.emit()
  }

  private startMeters(): void {
    if (this.timer === null && this.visible) this.timer = window.setInterval(() => this.emit(), 80)
  }

  private stopMeters(): void {
    if (this.timer !== null) window.clearInterval(this.timer)
    this.timer = null
  }

  async configure(settings: VoiceSettings): Promise<void> {
    for (const key of ['noiseGate', 'autoInputSensitivity', 'inputSensitivity'] as const) {
      if (settings[key] !== undefined) Object.assign(this.gateSettings, { [key]: settings[key] })
    }
    this.capture?.processor.setNoiseGate(this.gateSettings)
    if (settings.suppressionStrength !== undefined) this.suppressionStrength = settings.suppressionStrength
    this.capture?.processor.setSuppressionStrength(this.suppressionStrength)
    if (settings.noiseSuppression !== undefined) this.noiseSuppression = settings.noiseSuppression
    if (settings.inputVolume !== undefined) this.setInputVolume(settings.inputVolume)
    // Disable immediately, even while a device permission request is pending.
    if (!settings.enabled) {
      this.enabled = false
      this.muted = true
      this.deafened = false
      this.sync()
    }
    await this.run(async () => {
      const echo = settings.echoCancellation ?? this.echoCancellation
      const agc = settings.autoGainControl ?? this.autoGainControl
      const restart = echo !== this.echoCancellation || agc !== this.autoGainControl || settings.inputDeviceId !== this.inputDeviceId
      this.echoCancellation = echo
      this.autoGainControl = agc
      this.inputDeviceId = settings.inputDeviceId
      this.enabled = settings.enabled
      if (restart && this.capture) await this.stopCapture()
      else if (this.capture) await this.capture.processor.setNoiseSuppression(this.noiseSuppression)
      await this.reconcile()
    })
  }

  async setMuted(muted: boolean): Promise<void> {
    if (!this.enabled || this.testing) return
    if (!muted) this.deafened = false
    this.muted = muted
    this.sync()
    await this.run(() => this.reconcile())
  }

  async setDeafened(deafened: boolean): Promise<void> {
    if (!this.enabled || this.testing) return
    this.deafened = deafened
    this.sync()
    await this.run(() => this.reconcile())
  }

  setParticipantMuted(id: string, muted: boolean): void {
    if (!this.remote.has(id)) return
    if (muted) this.mutedIds.add(id)
    else this.mutedIds.delete(id)
    this.sync()
  }

  setParticipantVolume(id: string, volume: number): void {
    if (!Number.isFinite(volume) || !this.remote.has(id)) return
    this.participantVolumes.set(id, Math.max(0, Math.min(MAX_PLAYBACK_VOLUME, volume)))
    const entry = this.audio.get(id)
    if (entry) entry.gain.set(this.playbackVolume(id))
    this.emit()
  }

  private playbackVolume(id: string): number {
    return this.mutedIds.has(id) ? 0 : playbackGain(this.outputVolume) * playbackGain(this.participantVolumes.get(id) ?? 1)
  }

  /** Suspend voice without changing the user's mute preferences. */
  async setTesting(active: boolean): Promise<void> {
    if (this.testing === active) return
    this.testing = active
    this.sync()
    await this.run(() => this.reconcile())
  }

  setInputVolume(volume: number): void {
    if (!Number.isFinite(volume)) return
    this.inputVolume = Math.max(0, Math.min(1, volume))
    this.capture?.processor.setVolume(this.inputVolume)
    this.emit()
  }

  setOutputVolume(volume: number): void {
    if (!Number.isFinite(volume)) return
    this.outputVolume = Math.max(0, Math.min(MAX_PLAYBACK_VOLUME, volume))
    for (const [id, entry] of this.audio) entry.gain.set(this.playbackVolume(id))
    this.emit()
  }

  async setOutputDevice(id: string): Promise<void> {
    const previous = this.outputDeviceId
    this.outputDeviceId = id
    try { await Promise.all([...this.audio.values()].map(({ element }) => element.setSinkId(id))) }
    catch (error) {
      this.outputDeviceId = previous
      await Promise.allSettled([...this.audio.values()].map(({ element }) => element.setSinkId(previous)))
      throw error
    }
  }

  async resume(): Promise<void> {
    try {
      await Promise.all([this.context?.resume(), ...[...this.audio.values()].flatMap(({ element, receiver }) => [element.play(), receiver.play()])])
      this.onBlocked(false)
    } catch { this.onBlocked(true) }
  }

  close(): void {
    this.closed = true
    this.stopMeters()
    void this.stopCapture()
    for (const id of this.audio.keys()) this.removeAudio(id)
    for (const id of this.meters.keys()) this.removeMeter(id)
    // A shared playback context belongs to the session, which closes it.
    if (this.context && !this.playbackContext) void this.context.close().catch(() => undefined)
    if (this.inputContext) void this.inputContext.close().catch(() => undefined)
    this.inputContext = null
    this.context = null
    this.onBlocked(false)
  }

  private sending(): boolean {
    return this.enabled && !this.muted && !this.deafened && !this.testing && !this.closed
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.pending++
    this.emit()
    const result = this.queue.then(async () => { if (!this.closed) await action() })
    this.queue = result.catch(() => undefined)
    try { await result }
    finally { this.pending--; this.sync() }
  }

  private async stopCapture(): Promise<void> {
    const capture = this.capture
    this.capture = null
    if (!capture) return
    await this.connection.setMicrophone(null).catch(() => undefined)
    capture.stream.getTracks().forEach(track => track.stop())
    await capture.processor.destroy()
  }

  private async reconcile(): Promise<void> {
    if (this.closed) return
    try {
      if (this.sending() && !this.capture) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: {
          // RNNoise owns suppression. Capture processing is independently configurable.
          ...(this.inputDeviceId && this.inputDeviceId !== 'default' ? { deviceId: { exact: this.inputDeviceId } } : {}),
          channelCount: 1, sampleRate: 48000,
          echoCancellation: this.echoCancellation, noiseSuppression: false, autoGainControl: this.autoGainControl,
        } })
        // Do not send a late capture after the user muted or left.
        if (!this.sending()) { stream.getTracks().forEach(track => track.stop()); return }
        this.inputContext ??= new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' })
        const processor = new MicrophoneProcessor(this.inputContext, this.inputVolume, this.suppressionStrength, this.gateSettings)
        try {
          const [input] = stream.getAudioTracks()
          if (!input) throw new Error('The selected input is not a microphone.')
          await processor.init({ track: input })
          await processor.setNoiseSuppression(this.noiseSuppression)
        } catch (error) { stream.getTracks().forEach(track => track.stop()); await processor.destroy(); throw error }
        if (!this.sending()) { stream.getTracks().forEach(track => track.stop()); await processor.destroy(); return }
        this.capture = { stream, processor }
        await this.connection.setMicrophone(processor.processedTrack ?? null)
      } else if (!this.sending() && this.capture) {
        await this.stopCapture()
      }
    } catch (error) {
      this.muted = true
      await this.stopCapture()
      this.publishStatus()
      throw new Error(`Microphone unavailable: ${error instanceof Error ? error.message : String(error)}`)
    }
    this.publishStatus()
    this.sync()
  }

  private publishStatus(): void {
    if (this.closed) return
    this.connection.sendState(!this.capture, this.deafened || this.testing, this.enabled)
  }

  private sync(): void {
    if (this.closed) return
    const receiving = this.enabled && !this.deafened && !this.testing
    const wanted = receiving ? this.remoteMicrophones : new Map<string, MediaStreamTrack>()
    for (const id of this.audio.keys()) if (!wanted.has(id)) this.removeAudio(id)
    for (const [id, track] of wanted) this.attachAudio(id, track)
    for (const id of this.meters.keys()) if (!wanted.has(id) || this.remote.get(id)?.muted) this.removeMeter(id)
    for (const [id, track] of wanted) if (!this.remote.get(id)?.muted) this.addMeter(id, track)
    if (!this.audio.size) this.onBlocked(false)
    this.emit()
  }

  private attachAudio(id: string, track: MediaStreamTrack): void {
    let entry = this.audio.get(id)
    if (entry?.track !== track) {
      this.removeAudio(id)
      const element = document.createElement('audio')
      element.autoplay = true
      // Keep a muted receiver attached so Chromium continues decoding incoming
      // WebRTC audio while the gain graph feeds the selected output device.
      const stream = new MediaStream([track])
      const receiver = document.createElement('audio')
      receiver.muted = true
      receiver.volume = 0
      receiver.autoplay = true
      receiver.srcObject = stream
      this.context ??= this.playbackContext?.() ?? new AudioContext({ sampleRate: 48000 })
      const source = this.context.createMediaStreamSource(stream)
      const destination = this.context.createMediaStreamDestination()
      const gain = new PlaybackGain(this.context, destination)
      source.connect(gain.node)
      element.srcObject = destination.stream
      this.rack.append(element)
      entry = { track, element, receiver, source, gain, destination }
      this.audio.set(id, entry)
      void this.play(id, entry)
    }
    entry.element.muted = this.mutedIds.has(id)
    entry.gain.set(this.playbackVolume(id))
  }

  private async play(id: string, entry: VoicePlayback): Promise<void> {
    try {
      if (typeof entry.element.setSinkId === 'function') await entry.element.setSinkId(this.outputDeviceId)
      if (this.audio.get(id) !== entry) return
      await Promise.all([this.context?.resume(), entry.receiver.play(), entry.element.play()])
    } catch { if (this.audio.get(id) === entry) this.onBlocked(true) }
  }

  private removeAudio(id: string): void {
    const entry = this.audio.get(id)
    if (!entry) return
    this.removeMeter(id)
    entry.receiver.pause()
    entry.receiver.srcObject = null
    entry.receiver.remove()
    entry.source.disconnect()
    entry.gain.disconnect()
    entry.destination.stream.getTracks().forEach(track => track.stop())
    entry.element.pause()
    entry.element.srcObject = null
    entry.element.remove()
    this.audio.delete(id)
  }

  private addMeter(id: string, track: MediaStreamTrack): void {
    const source = this.audio.get(id)?.gain.node
    if (!source) return
    const previous = this.meters.get(id)
    if (previous?.track === track && previous.source === source) return
    this.removeMeter(id)
    try {
      const analyser = source.context.createAnalyser()
      analyser.fftSize = 1024
      source.connect(analyser)
      this.meters.set(id, { track, source, analyser, samples: new Float32Array(1024), activeUntil: 0 })
    } catch { /* Playback remains available if metering is unavailable. */ }
  }

  private removeMeter(id: string): void {
    const meter = this.meters.get(id)
    if (!meter) return
    // This is the playback gain, shared with the audible destination.
    meter.source.disconnect(meter.analyser)
    meter.analyser.disconnect()
    this.meters.delete(id)
  }

  private localState(): VoiceParticipant {
    const now = performance.now()
    const active = this.enabled && !this.muted && !this.deafened && !this.testing && Boolean(this.capture)
    const rms = active ? this.capture?.processor.getOutputRms() ?? 0 : 0
    this.localActiveUntil = voiceActiveUntil(rms, this.localActiveUntil, now)
    return {
      id: this.connection.userId, enabled: this.enabled, muted: !active, deafened: this.deafened || this.testing,
      locallyMuted: false, volume: 1, speaking: this.localActiveUntil > now,
    }
  }

  private remoteState(participant: MediaParticipant): VoiceParticipant {
    const id = participant.user_id
    const enabled = participant.voice_enabled
    const muted = !enabled || participant.deafened || participant.muted || !this.remoteMicrophones.has(id)
    const locallyMuted = this.mutedIds.has(id)
    let speaking = false
    const meter = this.meters.get(id)
    if (meter) {
      const now = performance.now()
      let rms = 0
      if (!muted && this.enabled && !this.deafened && !this.testing && !locallyMuted && this.playbackVolume(id) > 0 && !this.audio.get(id)?.element.paused) {
        meter.analyser.getFloatTimeDomainData(meter.samples)
        rms = Math.sqrt(meter.samples.reduce((sum, value) => sum + value * value, 0) / meter.samples.length)
      }
      meter.activeUntil = voiceActiveUntil(rms, meter.activeUntil, now)
      speaking = meter.activeUntil > now
    }
    return { id, enabled, muted, deafened: participant.deafened, locallyMuted, volume: this.participantVolumes.get(id) ?? 1, speaking }
  }

  private emit(): void {
    if (this.closed) return
    const local = this.localState()
    const state: VoiceState = {
      enabled: this.enabled, muted: local.muted, deafened: this.deafened || this.testing, busy: this.pending > 0,
      inputLevel: !this.reportInputLevel || this.muted || this.deafened || this.testing ? undefined : this.capture?.processor.inputLevel,
      participants: [local, ...[...this.remote.values()].map(participant => this.remoteState(participant))],
    }
    const signature = JSON.stringify(state)
    if (signature === this.signature) return
    this.signature = signature
    this.onState(state)
  }
}
