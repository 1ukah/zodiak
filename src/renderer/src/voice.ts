import { ConnectionState, Room, RoomEvent, Track, type Participant, type AudioProcessorOptions, type TrackProcessor } from 'livekit-client'

export interface VoiceParticipant {
  id: string
  enabled: boolean
  muted: boolean
  deafened: boolean
  locallyMuted: boolean
  speaking: boolean
}

export interface VoiceState {
  enabled: boolean
  muted: boolean
  deafened: boolean
  busy: boolean
  participants: VoiceParticipant[]
}

export interface VoiceSettings { enabled: boolean; inputDeviceId: string; inputVolume?: number }

/** Changes the samples sent to the room, including exact silence at zero. */
class MicrophoneGain implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  readonly name = 'microphone-volume'
  processedTrack?: MediaStreamTrack
  private source?: MediaStreamAudioSourceNode
  private gain?: GainNode
  constructor(private context: AudioContext, private volume: number) {}
  setVolume(volume: number): void {
    this.volume = volume
    if (this.gain) this.gain.gain.value = volume
  }
  async init({ track }: AudioProcessorOptions): Promise<void> {
    this.source = this.context.createMediaStreamSource(new MediaStream([track]))
    this.gain = this.context.createGain()
    this.gain.gain.value = this.volume
    const destination = this.context.createMediaStreamDestination()
    this.source.connect(this.gain).connect(destination)
    this.processedTrack = destination.stream.getAudioTracks()[0]
    await this.context.resume()
  }
  async restart(options: AudioProcessorOptions): Promise<void> { await this.destroy(); await this.init(options) }
  async destroy(): Promise<void> {
    this.source?.disconnect()
    this.gain?.disconnect()
    this.processedTrack?.stop()
    this.source = undefined
    this.gain = undefined
    this.processedTrack = undefined
  }
}

interface VoicePlayback {
  track: Track
  element: HTMLAudioElement
  receiver: HTMLAudioElement
  source: MediaStreamAudioSourceNode
  gain: GainNode
  destination: MediaStreamAudioDestinationNode
}

interface Meter {
  track: Track
  mediaTrack: MediaStreamTrack
  source: MediaStreamAudioSourceNode
  analyser: AnalyserNode
  samples: Float32Array<ArrayBuffer>
  activeUntil: number
}

/** Room microphones have their own subscriptions, playback, and mute state. */
export class RoomVoice {
  private enabled: boolean
  private inputDeviceId: string
  private muted = true
  private deafened = false
  private pending = 0
  private closed = false
  private queue: Promise<void> = Promise.resolve()
  private outputDeviceId = 'default'
  private outputVolume = 1
  private inputVolume: number
  private inputGain: MicrophoneGain | null = null
  private audio = new Map<string, VoicePlayback>()
  private mutedIds = new Set<string>()
  private meters = new Map<string, Meter>()
  private context: AudioContext | null = null
  private timer: number
  private signature = ''
  private unsubscribe: () => void

  constructor(private room: Room, private rack: HTMLElement, settings: VoiceSettings,
    private onState: (state: VoiceState) => void, private onBlocked: (blocked: boolean) => void) {
    this.enabled = settings.enabled
    this.inputDeviceId = settings.inputDeviceId
    this.inputVolume = Math.max(0, Math.min(1, settings.inputVolume ?? 1))
    const sync = () => this.sync()
    const reconnect = () => { void this.run(() => this.reconcile()).catch(() => { this.muted = true; this.emit() }) }
    room.on(RoomEvent.TrackSubscribed, sync).on(RoomEvent.TrackUnsubscribed, sync)
      .on(RoomEvent.TrackPublished, sync).on(RoomEvent.TrackUnpublished, sync)
      .on(RoomEvent.TrackMuted, sync).on(RoomEvent.TrackUnmuted, sync)
      .on(RoomEvent.LocalTrackPublished, sync).on(RoomEvent.LocalTrackUnpublished, sync)
      .on(RoomEvent.ParticipantConnected, sync).on(RoomEvent.ParticipantDisconnected, sync)
      .on(RoomEvent.ParticipantAttributesChanged, sync).on(RoomEvent.Reconnected, reconnect)
    this.unsubscribe = () => {
      room.off(RoomEvent.TrackSubscribed, sync).off(RoomEvent.TrackUnsubscribed, sync)
        .off(RoomEvent.TrackPublished, sync).off(RoomEvent.TrackUnpublished, sync)
        .off(RoomEvent.TrackMuted, sync).off(RoomEvent.TrackUnmuted, sync)
        .off(RoomEvent.LocalTrackPublished, sync).off(RoomEvent.LocalTrackUnpublished, sync)
        .off(RoomEvent.ParticipantConnected, sync).off(RoomEvent.ParticipantDisconnected, sync)
        .off(RoomEvent.ParticipantAttributesChanged, sync).off(RoomEvent.Reconnected, reconnect)
    }
    this.timer = window.setInterval(() => this.emit(), 80)
  }

  async start(): Promise<void> { await this.run(() => this.reconcile()) }

  async configure(settings: VoiceSettings): Promise<void> {
    // Disable immediately, even while a device permission request is pending.
    if (!settings.enabled) {
      this.enabled = false
      this.muted = true
      this.deafened = false
      this.silenceMicrophone()
      this.sync()
    }
    await this.run(async () => {
      const previousDevice = this.inputDeviceId
      if (settings.enabled && settings.inputDeviceId !== previousDevice && this.microphone()?.track) {
        try {
          if (!await this.room.switchActiveDevice('audioinput', settings.inputDeviceId)) throw new Error('The device did not switch.')
        }
        catch (error) {
          await this.room.switchActiveDevice('audioinput', previousDevice).catch(() => undefined)
          throw new Error(`Could not use that microphone: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      this.inputDeviceId = settings.inputDeviceId
      if (settings.inputVolume !== undefined) this.setInputVolume(settings.inputVolume)
      this.enabled = settings.enabled
      await this.reconcile()
    })
  }

  async setMuted(muted: boolean): Promise<void> {
    if (!this.enabled || this.deafened) return
    this.muted = muted
    if (muted) this.silenceMicrophone()
    this.emit()
    await this.run(() => this.reconcile())
  }

  async setDeafened(deafened: boolean): Promise<void> {
    if (!this.enabled) return
    this.deafened = deafened
    if (deafened) this.silenceMicrophone()
    this.sync()
    await this.run(() => this.reconcile())
  }

  setParticipantMuted(id: string, muted: boolean): void {
    if (!this.room.remoteParticipants.has(id)) return
    if (muted) this.mutedIds.add(id)
    else this.mutedIds.delete(id)
    this.sync()
  }

  setInputVolume(volume: number): void {
    if (!Number.isFinite(volume)) return
    this.inputVolume = Math.max(0, Math.min(1, volume))
    this.inputGain?.setVolume(this.inputVolume)
  }

  setOutputVolume(volume: number): void {
    if (!Number.isFinite(volume)) return
    this.outputVolume = Math.max(0, Math.min(2, volume))
    for (const [id, entry] of this.audio) entry.gain.gain.value = this.mutedIds.has(id) ? 0 : this.outputVolume
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
    this.silenceMicrophone()
    this.microphone()?.track?.stop()
    window.clearInterval(this.timer)
    this.unsubscribe()
    for (const id of this.audio.keys()) this.removeAudio(id)
    for (const id of this.meters.keys()) this.removeMeter(id)
    if (this.context) void this.context.close().catch(() => undefined)
    this.context = null
    this.onBlocked(false)
  }

  private microphone() { return this.room.localParticipant.getTrackPublication(Track.Source.Microphone) }

  private silenceMicrophone(): void {
    const track = this.microphone()?.track
    if (track) track.mediaStreamTrack.enabled = false
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.pending++
    this.emit()
    const result = this.queue.then(async () => { if (!this.closed) await action() })
    this.queue = result.catch(() => undefined)
    try { await result }
    finally { this.pending--; this.sync() }
  }

  private async reconcile(): Promise<void> {
    if (this.closed || this.room.state !== ConnectionState.Connected) return
    try {
      const shouldPublish = this.enabled && !this.muted && !this.deafened
      if (!this.enabled) {
        const track = this.microphone()?.track
        if (track) await this.room.localParticipant.unpublishTrack(track, true)
      } else if (shouldPublish) {
        const publication = this.microphone()
        if (publication?.track) {
          await publication.track.unmute()
          // A quick mute/unmute can cancel the queued mute after we silenced
          // the processed track. The SDK only toggles its original input track.
          publication.track.mediaStreamTrack.enabled = true
        }
        else {
          const [track] = await this.room.localParticipant.createTracks({ audio: {
            deviceId: this.inputDeviceId, echoCancellation: true, noiseSuppression: true, autoGainControl: true,
          } })
          try {
            // Do not publish a late capture after the user muted or left.
            if (this.closed || !this.enabled || this.muted || this.deafened) { track.stop(); return }
            this.context ??= new AudioContext()
            this.inputGain = new MicrophoneGain(this.context, this.inputVolume)
            if (track.kind !== Track.Kind.Audio) throw new Error('The selected input is not a microphone.')
            const audioTrack = track as import('livekit-client').LocalAudioTrack
            audioTrack.setAudioContext(this.context)
            await audioTrack.setProcessor(this.inputGain)
            if (this.closed || !this.enabled || this.muted || this.deafened) { track.stop(); return }
            await this.room.localParticipant.publishTrack(audioTrack, { source: Track.Source.Microphone, stopMicTrackOnMute: true })
          } catch (error) { track.stop(); throw error }
        }
      } else {
        await this.microphone()?.track?.mute()
      }
      // Capture can resolve after leaving, disabling voice, or deafening.
      if (this.closed || !this.enabled || this.muted || this.deafened) {
        this.silenceMicrophone()
        if (this.closed || !this.enabled) this.microphone()?.track?.stop()
        else await this.microphone()?.track?.mute()
      }
      if (this.closed) return
    } catch (error) {
      this.muted = true
      this.silenceMicrophone()
      this.microphone()?.track?.stop()
      const failedTrack = this.microphone()?.track
      if (failedTrack) await this.room.localParticipant.unpublishTrack(failedTrack, true).catch(() => undefined)
      await this.publishStatus().catch(() => undefined)
      throw new Error(`Microphone unavailable: ${error instanceof Error ? error.message : String(error)}`)
    }
    await this.publishStatus()
    this.sync()
  }

  private async publishStatus(): Promise<void> {
    if (this.closed || this.room.state !== ConnectionState.Connected) return
    await this.room.localParticipant.setAttributes({
      'zodiak.voice.enabled': String(this.enabled),
      'zodiak.voice.deafened': String(this.deafened),
    })
  }

  private sync(): void {
    if (this.closed) return
    const receiving = this.enabled && !this.deafened
    const wantedAudio = new Set<string>()
    const wantedMeters = new Map<string, Track>()
    this.room.remoteParticipants.forEach(participant => {
      const publication = participant.getTrackPublication(Track.Source.Microphone)
      if (publication && publication.isDesired !== receiving) publication.setSubscribed(receiving)
      const track = publication?.track
      if (receiving && track) {
        wantedAudio.add(participant.identity)
        this.attachAudio(participant.identity, track)
        if (!publication.isMuted) wantedMeters.set(participant.identity, track)
      }
    })
    const localTrack = this.microphone()?.track
    if (localTrack && this.enabled && !this.muted && !this.deafened) wantedMeters.set(this.room.localParticipant.identity, localTrack)
    for (const id of this.audio.keys()) if (!wantedAudio.has(id)) this.removeAudio(id)
    for (const id of this.meters.keys()) if (!wantedMeters.has(id)) this.removeMeter(id)
    for (const [id, track] of wantedMeters) this.addMeter(id, track)
    for (const id of this.mutedIds) if (!this.room.remoteParticipants.has(id)) this.mutedIds.delete(id)
    if (!this.audio.size) this.onBlocked(false)
    this.emit()
  }

  private attachAudio(id: string, track: Track): void {
    let entry = this.audio.get(id)
    if (entry?.track !== track) {
      this.removeAudio(id)
      const element = document.createElement('audio')
      element.autoplay = true
      element.muted = this.mutedIds.has(id)
      // Keep a muted receiver attached so Chromium continues decoding incoming
      // WebRTC audio while the gain graph feeds the selected output device.
      const stream = new MediaStream([track.mediaStreamTrack])
      const receiver = document.createElement('audio')
      receiver.muted = true
      receiver.volume = 0
      receiver.autoplay = true
      // LiveKit's attach() unmutes audio elements and can create its own output
      // graph. Assign the stream directly so only the processed element is heard.
      receiver.srcObject = stream
      this.context ??= new AudioContext()
      const source = this.context.createMediaStreamSource(stream)
      const gain = this.context.createGain()
      gain.gain.value = this.mutedIds.has(id) ? 0 : this.outputVolume
      const destination = this.context.createMediaStreamDestination()
      source.connect(gain).connect(destination)
      element.srcObject = destination.stream
      this.rack.append(element)
      entry = { track, element, receiver, source, gain, destination }
      this.audio.set(id, entry)
      void this.play(id, entry)
    }
    entry.element.muted = this.mutedIds.has(id)
    entry.gain.gain.value = this.mutedIds.has(id) ? 0 : this.outputVolume
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

  private addMeter(id: string, track: Track): void {
    const previous = this.meters.get(id)
    if (previous?.track === track && previous.mediaTrack === track.mediaStreamTrack) return
    this.removeMeter(id)
    try {
      this.context ??= new AudioContext()
      void this.context.resume().catch(() => undefined)
      const source = this.context.createMediaStreamSource(new MediaStream([track.mediaStreamTrack]))
      const analyser = this.context.createAnalyser()
      analyser.fftSize = 512
      source.connect(analyser)
      this.meters.set(id, { track, mediaTrack: track.mediaStreamTrack, source, analyser, samples: new Float32Array(512), activeUntil: 0 })
    } catch { /* Playback remains available if metering is unavailable. */ }
  }

  private removeMeter(id: string): void {
    const meter = this.meters.get(id)
    if (!meter) return
    meter.source.disconnect()
    meter.analyser.disconnect()
    this.meters.delete(id)
  }

  private participantState(participant: Participant, local: boolean): VoiceParticipant {
    const publication = participant.getTrackPublication(Track.Source.Microphone)
    const enabled = local ? this.enabled : participant.attributes['zodiak.voice.enabled'] === 'true' ||
      (participant.attributes['zodiak.voice.enabled'] !== 'false' && Boolean(publication))
    const deafened = local ? this.deafened : participant.attributes['zodiak.voice.deafened'] === 'true'
    const muted = !enabled || deafened || !publication || publication.isMuted || (local && this.muted)
    const locallyMuted = this.mutedIds.has(participant.identity)
    let speaking = false
    const meter = this.meters.get(participant.identity)
    if (meter && !muted && !locallyMuted && this.enabled && !this.deafened) {
      meter.analyser.getFloatTimeDomainData(meter.samples)
      const rms = Math.sqrt(meter.samples.reduce((sum, value) => sum + value * value, 0) / meter.samples.length)
      if (rms > 0.012) meter.activeUntil = performance.now() + 250
      speaking = meter.activeUntil > performance.now()
    }
    return { id: participant.identity, enabled, muted, deafened, locallyMuted, speaking }
  }

  private emit(): void {
    if (this.closed) return
    const state: VoiceState = {
      enabled: this.enabled, muted: this.muted || this.deafened || !this.enabled || !this.microphone() || this.microphone()!.isMuted,
      deafened: this.deafened, busy: this.pending > 0,
      participants: [this.participantState(this.room.localParticipant, true),
        ...[...this.room.remoteParticipants.values()].map(participant => this.participantState(participant, false))],
    }
    const signature = JSON.stringify(state)
    if (signature === this.signature) return
    this.signature = signature
    this.onState(state)
  }
}
