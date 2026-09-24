const workletSource = `
const CAPACITY = 48000 * 2
const PRIME = 48000 * 2 * 0.12

class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super()
    this.samples = new Float32Array(CAPACITY)
    this.read = 0
    this.write = 0
    this.filled = 0
    this.primed = false
    this.port.onmessage = (event) => {
      const bytes = new Uint8Array(event.data)
      const length = bytes.byteLength - (bytes.byteLength % 2)
      if (length < 2) return
      const aligned = new ArrayBuffer(length)
      new Uint8Array(aligned).set(bytes.subarray(0, length))
      this.push(new Int16Array(aligned))
    }
  }

  push(view) {
    let data = view
    if (data.length > CAPACITY) data = data.subarray(data.length - CAPACITY)
    const overflow = this.filled + data.length - CAPACITY
    if (overflow > 0) this.drop(overflow)
    for (let i = 0; i < data.length; i += 1) {
      this.samples[this.write] = data[i] / 32768
      this.write += 1
      if (this.write === CAPACITY) this.write = 0
    }
    this.filled += data.length
  }

  drop(count) {
    this.read += count
    if (this.read >= CAPACITY) this.read %= CAPACITY
    this.filled -= count
  }

  pull(left, right) {
    const frames = left.length
    for (let i = 0; i < frames; i += 1) {
      if (this.filled < 2) {
        left[i] = 0
        right[i] = 0
        continue
      }
      left[i] = this.samples[this.read]
      this.read += 1
      if (this.read === CAPACITY) this.read = 0
      right[i] = this.samples[this.read]
      this.read += 1
      if (this.read === CAPACITY) this.read = 0
      this.filled -= 2
    }
  }

  process(_inputs, outputs) {
    const channels = outputs[0]
    const left = channels ? channels[0] : undefined
    const right = channels ? channels[1] : undefined
    if (!left || !right) return true
    if (!this.primed) {
      if (this.filled < PRIME) {
        left.fill(0)
        right.fill(0)
        return true
      }
      this.primed = true
    }
    this.pull(left, right)
    return true
  }
}

registerProcessor('pcm-capture', PcmCapture)
`

let context: AudioContext | null = null
let worklet: AudioWorkletNode | null = null
let mediaTrack: MediaStreamTrack | null = null
let unsubscribe: (() => void) | null = null

export async function openSystemAudioTrack(): Promise<MediaStreamTrack> {
  await closeSystemAudio()
  const ctx = new AudioContext({ sampleRate: 48000 })
  context = ctx
  const blob = new Blob([workletSource], { type: 'text/javascript' })
  const url = URL.createObjectURL(blob)
  try {
    await ctx.audioWorklet.addModule(url)
  } finally {
    URL.revokeObjectURL(url)
  }
  const node = new AudioWorkletNode(ctx, 'pcm-capture', {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
  })
  worklet = node
  const destination = ctx.createMediaStreamDestination()
  node.connect(destination)
  unsubscribe = window.sharescreen.onSystemAudio((pcm) => {
    const copy = new Uint8Array(pcm.byteLength)
    copy.set(pcm)
    node.port.postMessage(copy.buffer, [copy.buffer])
  })
  const started = await window.sharescreen.startSystemAudio()
  if (!started.ok) {
    await closeSystemAudio()
    throw new Error(started.error)
  }
  const [audioTrack] = destination.stream.getAudioTracks()
  if (!audioTrack) {
    await closeSystemAudio()
    throw new Error('System audio did not start')
  }
  mediaTrack = audioTrack
  if (ctx.state === 'suspended') await ctx.resume()
  return audioTrack
}

export async function closeSystemAudio(): Promise<void> {
  const stopListening = unsubscribe
  unsubscribe = null
  if (stopListening) stopListening()
  const node = worklet
  worklet = null
  if (node) node.disconnect()
  const currentTrack = mediaTrack
  mediaTrack = null
  if (currentTrack) currentTrack.stop()
  const ctx = context
  context = null
  if (ctx && ctx.state !== 'closed') await ctx.close().catch(() => undefined)
  if (window.sharescreen) await window.sharescreen.stopSystemAudio()
}
