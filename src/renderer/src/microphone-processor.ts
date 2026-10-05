import { Track, type AudioProcessorOptions, type TrackProcessor } from 'livekit-client'
import { createNoiseGateNode, type NoiseGateSettings, type InputLevel } from './noise-gate'

/** One LiveKit processor combines denoising, sensitivity gating, and input gain. */
export class MicrophoneProcessor implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  readonly name = 'microphone-processing'
  processedTrack?: MediaStreamTrack
  private source?: MediaStreamAudioSourceNode
  private gain?: GainNode
  private analyser?: AnalyserNode
  private samples = new Float32Array(1024)
  private gate?: AudioWorkletNode
  private generation = 0
  inputLevel?: InputLevel
  private noise?: AudioWorkletNode
  private noiseRequest?: AbortController
  private noiseEnabled = false

  constructor(private context: AudioContext, private volume: number, private strength = .8,
    private gateSettings: NoiseGateSettings = {}, private onLevel?: (level: InputLevel) => void) {}

  setNoiseGate(settings: NoiseGateSettings): void {
    this.gateSettings = { ...this.gateSettings, ...settings }
    this.gate?.port.postMessage(this.gateSettings)
  }

  setSuppressionStrength(strength: number): void {
    this.strength = Number.isFinite(strength) ? Math.max(0, Math.min(1, strength)) : .8
    if (this.strength === 0) this.removeNoise()
    else this.noise?.port.postMessage({ type: 'strength', value: this.strength })
  }

  setVolume(volume: number): void {
    this.volume = volume
    if (this.gain) this.gain.gain.value = volume
  }

  /** The exact signal sent to LiveKit, after every filter and input gain. */
  getOutputRms(): number {
    if (this.volume <= 0 || !this.analyser || this.context.state !== 'running' || !this.processedTrack?.enabled || this.processedTrack.readyState !== 'live') return 0
    this.analyser.getFloatTimeDomainData(this.samples)
    return Math.sqrt(this.samples.reduce((sum, value) => sum + value * value, 0) / this.samples.length)
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
      if (this.gate) this.source?.connect(this.gate)
    }
  }

  async setNoiseSuppression(enabled: boolean): Promise<void> {
    if (enabled && this.noiseEnabled && this.noise) return
    this.noiseEnabled = enabled
    this.removeNoise()
    if (!enabled || this.strength === 0 || !this.source || !this.gate) return
    const request = new AbortController()
    this.noiseRequest = request
    try {
      const { createNoiseSuppressionNode, stopNoiseSuppressionNode } = await import('./noise-suppression')
      request.signal.throwIfAborted()
      const node = await createNoiseSuppressionNode(this.context, request.signal, this.strength)
      if (request.signal.aborted || this.strength === 0) { stopNoiseSuppressionNode(node); return }
      this.noise = node
      node.port.postMessage({ type: 'strength', value: this.strength })
      this.source.disconnect()
      this.source.connect(node).connect(this.gate)
    } catch (error) {
      if (!request.signal.aborted) throw error
    } finally {
      if (this.noiseRequest === request) this.noiseRequest = undefined
    }
  }

  async init({ track }: AudioProcessorOptions): Promise<void> {
    const generation = ++this.generation
    this.source = this.context.createMediaStreamSource(new MediaStream([track]))
    this.gain = this.context.createGain()
    this.gain.gain.value = this.volume
    const destination = this.context.createMediaStreamDestination()
    try {
      const gate = await createNoiseGateNode(this.context, this.gateSettings)
      if (generation !== this.generation) { gate.port.postMessage('stop'); gate.port.close(); return }
      this.gate = gate
      gate.port.onmessage = event => { this.inputLevel = event.data; this.onLevel?.(event.data) }
      this.source.connect(gate).connect(this.gain).connect(destination)
      this.analyser = this.context.createAnalyser()
      this.analyser.fftSize = this.samples.length
      this.gain.connect(this.analyser)
      this.processedTrack = destination.stream.getAudioTracks()[0]
      await this.context.resume()
      await this.setNoiseSuppression(this.noiseEnabled)
    } catch (error) { await this.destroy(); throw error }
  }

  async restart(options: AudioProcessorOptions): Promise<void> { await this.destroy(); await this.init(options) }

  async destroy(): Promise<void> {
    this.generation++
    this.removeNoise()
    this.gate?.disconnect()
    this.gate?.port.postMessage('stop')
    this.gate?.port.close()
    this.source?.disconnect()
    this.gain?.disconnect()
    this.analyser?.disconnect()
    this.processedTrack?.stop()
    this.source = undefined
    this.gain = undefined
    this.analyser = undefined
    this.gate = undefined
    this.inputLevel = undefined
    this.processedTrack = undefined
  }
}
