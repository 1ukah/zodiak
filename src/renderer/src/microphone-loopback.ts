import { Track } from 'livekit-client'
import { MicrophoneProcessor } from './microphone-processor'

export interface LoopbackSettings {
  inputDeviceId: string
  inputVolume: number
  noiseSuppression: boolean
  suppressionStrength?: number
  outputDeviceId: string
  outputVolume: number
}

interface LoopbackResources {
  stream: MediaStream
  context: AudioContext
  processor: MicrophoneProcessor
  output?: {
    source: MediaStreamAudioSourceNode
    gain: GainNode
    destination: MediaStreamAudioDestinationNode
    audio: HTMLAudioElement
  }
}

/** A local microphone test; it never publishes or changes the room's mute state. */
export class MicrophoneLoopback {
  private generation = 0
  private current?: LoopbackResources
  private settings?: LoopbackSettings
  private startup?: Promise<void>
  active = false

  async start(settings: LoopbackSettings): Promise<void> {
    this.stop()
    this.settings = { ...settings }
    this.active = true
    const generation = this.generation
    const startup = this.open(generation)
    this.startup = startup
    try { await startup }
    catch (error) {
      if (generation === this.generation) { this.stop(); throw error }
    } finally {
      if (this.startup === startup) this.startup = undefined
    }
  }

  private async open(generation: number): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: {
      deviceId: this.settings!.inputDeviceId === 'default' ? undefined : { exact: this.settings!.inputDeviceId },
      // Match room capture: RNNoise is the only noise suppressor.
      echoCancellation: true, noiseSuppression: false, autoGainControl: true,
    } })
    if (generation !== this.generation) { stream.getTracks().forEach(track => track.stop()); return }
    let context: AudioContext
    try { context = new AudioContext({ sampleRate: 48000 }) }
    catch (error) { stream.getTracks().forEach(track => track.stop()); throw error }
    const state: LoopbackResources = {
      stream, context, processor: new MicrophoneProcessor(context, this.settings!.inputVolume, this.settings!.suppressionStrength ?? .8),
    }
    this.current = state
    await state.processor.init({ kind: Track.Kind.Audio, track: stream.getAudioTracks()[0], audioContext: context })
    if (generation !== this.generation) return
    const source = context.createMediaStreamSource(new MediaStream([state.processor.processedTrack!]))
    const gain = context.createGain()
    const destination = context.createMediaStreamDestination()
    source.connect(gain).connect(destination)
    const audio = document.createElement('audio')
    audio.hidden = true
    audio.dataset.voiceLoopback = 'true'
    audio.srcObject = destination.stream
    document.body.append(audio)
    state.output = { source, gain, destination, audio }
    await this.apply(state)
    if (generation !== this.generation) return
    await audio.play()
  }

  async configure(settings: LoopbackSettings): Promise<void> {
    const previousDevice = this.settings?.inputDeviceId
    this.settings = { ...settings }
    if (!this.active) return
    if (settings.inputDeviceId !== previousDevice) { await this.start(settings); return }
    this.current?.processor.setVolume(settings.inputVolume)
    this.current?.processor.setSuppressionStrength(settings.suppressionStrength ?? .8)
    if (!settings.noiseSuppression) this.current?.processor.disableNoiseSuppression()
    if (this.current?.output) this.current.output.gain.gain.value = settings.outputVolume
    await this.startup
    const state = this.current
    if (state && this.active) await this.apply(state)
  }

  private async apply(state: LoopbackResources): Promise<void> {
    state.processor.setVolume(this.settings!.inputVolume)
    state.processor.setSuppressionStrength(this.settings!.suppressionStrength ?? .8)
    await state.processor.setNoiseSuppression(this.settings!.noiseSuppression)
    if (this.current !== state || !state.output) return
    state.output.gain.gain.value = this.settings!.outputVolume
    if (state.output.audio.sinkId !== this.settings!.outputDeviceId) {
      await state.output.audio.setSinkId(this.settings!.outputDeviceId)
    }
  }

  stop(): void {
    this.generation++
    this.active = false
    this.startup = undefined
    const state = this.current
    this.current = undefined
    if (!state) return
    if (state.output) {
      state.output.audio.pause()
      state.output.audio.srcObject = null
      state.output.audio.remove()
      state.output.source.disconnect()
      state.output.gain.disconnect()
      state.output.destination.stream.getTracks().forEach(track => track.stop())
    }
    void state.processor.destroy()
    state.stream.getTracks().forEach(track => track.stop())
    if (state.context.state !== 'closed') void state.context.close().catch(() => undefined)
  }
}
