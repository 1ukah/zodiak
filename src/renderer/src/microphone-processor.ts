import { Track, type AudioProcessorOptions, type TrackProcessor } from 'livekit-client'

/** One LiveKit processor combines optional denoising and the input slider. */
export class MicrophoneProcessor implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  readonly name = 'microphone-processing'
  processedTrack?: MediaStreamTrack
  private source?: MediaStreamAudioSourceNode
  private gain?: GainNode
  private noise?: AudioWorkletNode
  private noiseRequest?: AbortController
  private noiseEnabled = false

  constructor(private context: AudioContext, private volume: number, private strength = .8) {}

  setSuppressionStrength(strength: number): void {
    this.strength = Number.isFinite(strength) ? Math.max(0, Math.min(1, strength)) : .8
    if (this.strength === 0) this.removeNoise()
    else this.noise?.port.postMessage({ type: 'strength', value: this.strength })
  }

  setVolume(volume: number): void {
    this.volume = volume
    if (this.gain) this.gain.gain.value = volume
  }

  disableNoiseSuppression(): void {
    this.noiseEnabled = false
    this.removeNoise()
  }

  private removeNoise(): void {
    this.noiseRequest?.abort()
    this.noiseRequest = undefined
    if (this.noise) {
      this.source?.disconnect()
      this.noise.disconnect()
      this.noise.port.postMessage('stop')
      this.noise.port.close()
      this.noise = undefined
      if (this.gain) this.source?.connect(this.gain)
    }
  }

  async setNoiseSuppression(enabled: boolean): Promise<void> {
    if (enabled && this.noiseEnabled && this.noise) return
    this.noiseEnabled = enabled
    this.removeNoise()
    if (!enabled || this.strength === 0 || !this.source || !this.gain) return
    const request = new AbortController()
    this.noiseRequest = request
    try {
      const { createNoiseSuppressionNode, stopNoiseSuppressionNode } = await import('./noise-suppression')
      request.signal.throwIfAborted()
      const node = await createNoiseSuppressionNode(this.context, request.signal, this.strength)
      if (request.signal.aborted) { stopNoiseSuppressionNode(node); return }
      this.noise = node
      node.port.postMessage({ type: 'strength', value: this.strength })
      this.source.disconnect()
      this.source.connect(node).connect(this.gain)
    } catch (error) {
      if (!request.signal.aborted) throw error
    } finally {
      if (this.noiseRequest === request) this.noiseRequest = undefined
    }
  }

  async init({ track }: AudioProcessorOptions): Promise<void> {
    this.source = this.context.createMediaStreamSource(new MediaStream([track]))
    this.gain = this.context.createGain()
    this.gain.gain.value = this.volume
    const destination = this.context.createMediaStreamDestination()
    this.source.connect(this.gain).connect(destination)
    this.processedTrack = destination.stream.getAudioTracks()[0]
    try {
      await this.context.resume()
      await this.setNoiseSuppression(this.noiseEnabled)
    } catch (error) { await this.destroy(); throw error }
  }

  async restart(options: AudioProcessorOptions): Promise<void> { await this.destroy(); await this.init(options) }

  async destroy(): Promise<void> {
    this.removeNoise()
    this.source?.disconnect()
    this.gain?.disconnect()
    this.processedTrack?.stop()
    this.source = undefined
    this.gain = undefined
    this.processedTrack = undefined
  }
}
