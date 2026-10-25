/** Volume sliders go from 0% to 200%. */
export const MAX_PLAYBACK_VOLUME = 2

/**
 * Maps a slider value to amplitude gain. Up to 100% the gain is linear, as
 * before. Above it the boost is squared: a linear 2x is only +6 dB and sounds
 * barely louder, while 200% here is 4x (+12 dB), roughly twice as loud.
 */
export function playbackGain(volume: number): number {
  const value = Number.isFinite(volume) ? Math.max(0, Math.min(MAX_PLAYBACK_VOLUME, volume)) : 1
  return value <= 1 ? value : value * value
}

/**
 * gain → (limiter, only while boosting) → output. The limiter keeps boosted
 * audio from hard-clipping. It stays out of the path at or below 100%, so
 * normal playback has no added latency or processing.
 */
export class PlaybackGain {
  readonly node: GainNode
  private limiter: DynamicsCompressorNode | null = null
  private limited = false

  constructor(private context: BaseAudioContext, private output: AudioNode) {
    this.node = context.createGain()
    this.node.gain.value = 0
    this.node.connect(output)
  }

  set(gain: number): void {
    this.node.gain.value = gain
    const limit = gain > 1
    if (limit === this.limited) return
    this.limited = limit
    if (limit) {
      if (!this.limiter) {
        this.limiter = this.context.createDynamicsCompressor()
        this.limiter.threshold.value = -1
        this.limiter.knee.value = 0
        this.limiter.ratio.value = 20
        this.limiter.attack.value = .002
        this.limiter.release.value = .2
        this.limiter.connect(this.output)
      }
      this.node.disconnect(this.output)
      this.node.connect(this.limiter)
    } else {
      this.node.disconnect(this.limiter!)
      this.node.connect(this.output)
    }
  }

  disconnect(): void {
    this.node.disconnect()
    this.limiter?.disconnect()
  }
}
