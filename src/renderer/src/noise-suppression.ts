import rnnoiseSource from '@jitsi/rnnoise-wasm/dist/rnnoise-sync.js?raw'

// The synchronous build embeds RNNoise 0.2 and its model. No network or worker
// runs until a microphone actually needs suppression.
export const noiseWorkletSource = rnnoiseSource + `
class NoiseSuppression extends AudioWorkletProcessor {
  constructor(options) {
    super();
    if (sampleRate !== 48000) throw new Error('RNNoise requires 48 kHz audio');
    this.module = createRNNWasmModuleSync();
    this.state = this.module._rnnoise_create(0);
    this.pointer = this.module._malloc(480 * 4);
    if (!this.state || !this.pointer) { this.stop(); throw new Error('Could not allocate RNNoise'); }
    this.frame = new Float32Array(480);
    this.inputCount = 0;
    this.output = new Float32Array(960);
    this.read = 0;
    this.write = 480;
    this.strength = options?.processorOptions?.strength ?? 1;
    this.targetStrength = this.strength;
    // RNNoise 0.2 delays synthesis by two 480-sample frames. The adapter
    // adds one more. Align the original signal before blending it back in.
    this.dry = new Float32Array(1440);
    this.dryIndex = 0;
    this.port.onmessage = event => {
      if (event.data === 'stop') this.stop();
      else if (event.data?.type === 'strength' && Number.isFinite(event.data.value)) {
        this.targetStrength = Math.max(0, Math.min(1, event.data.value));
      }
    };
    this.port.postMessage('ready');
  }
  stop() {
    if (this.state) this.module._rnnoise_destroy(this.state);
    if (this.pointer) this.module._free(this.pointer);
    this.state = 0;
    this.pointer = 0;
    this.module = null;
    this.port.close();
  }
  process(inputs, outputs) {
    const output = outputs[0][0];
    if (!this.state) { output.fill(0); return false; }
    const input = inputs[0][0];
    // Reconcile Web Audio's render quanta with RNNoise's 480-sample frames.
    // Start with one frame of silence to keep output continuous at boundaries.
    for (let i = 0; i < output.length; i++) {
      const sample = input ? input[i] : 0;
      const dry = this.dry[this.dryIndex];
      this.dry[this.dryIndex] = sample;
      this.dryIndex = (this.dryIndex + 1) % this.dry.length;
      this.frame[this.inputCount++] = sample * 32768;
      if (this.inputCount === 480) {
        const offset = this.pointer / 4;
        this.module.HEAPF32.set(this.frame, offset);
        this.module._rnnoise_process_frame(this.state, this.pointer, this.pointer);
        for (let j = 0; j < 480; j++) {
          this.output[this.write] = this.module.HEAPF32[offset + j] / 32768;
          this.write = (this.write + 1) % this.output.length;
        }
        this.inputCount = 0;
      }
      this.strength += (this.targetStrength - this.strength) * .002;
      output[i] = this.strength * this.output[this.read] + (1 - this.strength) * dry;
      this.read = (this.read + 1) % this.output.length;
    }
    return true;
  }
}
registerProcessor('microphone-noise-suppression', NoiseSuppression);
`

const modules = new WeakMap<AudioContext, Promise<void>>()

export function stopNoiseSuppressionNode(node: AudioWorkletNode): void {
  node.disconnect()
  node.port.postMessage('stop')
  node.port.close()
}

export async function createNoiseSuppressionNode(context: AudioContext, signal: AbortSignal, strength = 1): Promise<AudioWorkletNode> {
  let loading = modules.get(context)
  if (!loading) {
    const url = URL.createObjectURL(new Blob([noiseWorkletSource], { type: 'text/javascript' }))
    loading = context.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url))
    modules.set(context, loading)
    void loading.catch(() => modules.delete(context))
  }
  await loading
  signal.throwIfAborted()
  const node = new AudioWorkletNode(context, 'microphone-noise-suppression', {
    numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
    channelCount: 1, channelCountMode: 'explicit',
    processorOptions: { strength },
  })
  try {
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timeout)
        signal.removeEventListener('abort', abort)
        node.port.onmessage = null
        node.onprocessorerror = null
        if (error) reject(error)
        else resolve()
      }
      const abort = () => finish(new DOMException('Noise suppression cancelled', 'AbortError'))
      const timeout = window.setTimeout(() => finish(new Error('Noise suppression did not start')), 10_000)
      signal.addEventListener('abort', abort, { once: true })
      node.port.onmessage = event => { if (event.data === 'ready') finish() }
      node.onprocessorerror = () => finish(new Error('Noise suppression could not start'))
      if (signal.aborted) abort()
    })
    signal.throwIfAborted()
    return node
  } catch (error) {
    stopNoiseSuppressionNode(node)
    throw error
  }
}
