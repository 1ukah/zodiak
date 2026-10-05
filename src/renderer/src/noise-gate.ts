export interface NoiseGateSettings {
  noiseGate?: boolean
  autoInputSensitivity?: boolean
  inputSensitivity?: number
}

export interface InputLevel { db: number; threshold: number; open: boolean }

// Runs on the audio thread, so a busy renderer cannot delay opening the mic.
// Detection precedes the volume slider. A 10 ms lookahead preserves word starts.
export const noiseGateWorkletSource = `
class NoiseGate extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.settings = options.processorOptions || {};
    this.delay = new Float32Array(Math.round(sampleRate * .01));
    this.index = 0;
    this.energy = 0;
    this.floor = -60;
    this.open = false;
    this.hold = 0;
    this.gain = 0;
    this.report = 0;
    this.db = -100;
    this.threshold = -50;
    this.detect = 0;
    this.window = 0;
    this.minimum = 0;
    this.maximum = -100;
    this.stopped = false;
    this.port.onmessage = event => {
      if (event.data === 'stop') { this.stopped = true; this.port.close(); }
      else this.settings = event.data;
    };
  }
  process(inputs, outputs) {
    const output = outputs[0][0];
    if (this.stopped) { output.fill(0); return false; }
    const input = inputs[0][0];
    let db = this.db, threshold = this.threshold;
    for (let i = 0; i < output.length; i++) {
      const sample = input?.[i] || 0;
      const delayed = this.delay[this.index];
      this.energy = Math.max(0, this.energy + sample * sample - delayed * delayed);
      this.delay[this.index] = sample;
      this.index = (this.index + 1) % this.delay.length;
      // Update detection at 1 kHz, without transcendental math per sample.
      if (++this.detect >= sampleRate / 1000) {
        this.detect = 0;
        db = Math.max(-100, 10 * Math.log10(Math.max(1e-10, this.energy / this.delay.length)));
        if (!this.open || db < this.floor + 6) {
          const seconds = db < this.floor ? .5 : 3;
          this.floor += (db - this.floor) / (1000 * seconds);
        }
        this.minimum = Math.min(this.minimum, db);
        this.maximum = Math.max(this.maximum, db);
        // A steady quiet background can initially exceed the threshold. Learn
        // it after a full second; speech's changing envelope does not qualify.
        if (++this.window >= 1000) {
          if (this.maximum - this.minimum < 6 && this.maximum < -35) this.floor = this.minimum;
          this.window = 0; this.minimum = 0; this.maximum = -100;
        }
        threshold = this.settings.autoInputSensitivity !== false
          ? Math.max(-60, Math.min(-25, this.floor + 10))
          : Math.max(-100, Math.min(0, this.settings.inputSensitivity ?? -50));
      }
      if (this.settings.noiseGate === false || db >= threshold) {
        this.open = true;
        this.hold = Math.round(sampleRate * .18);
      } else if (this.open) {
        if (db >= threshold - 6) this.hold = Math.round(sampleRate * .18);
        else if (--this.hold <= 0) this.open = false;
      }
      const target = this.open ? 1 : 0;
      const step = 1 / (sampleRate * (this.open ? .003 : .08));
      this.gain += Math.max(-step, Math.min(step, target - this.gain));
      output[i] = delayed * this.gain;
    }
    this.db = db; this.threshold = threshold;
    if ((this.report += output.length) >= sampleRate / 20) {
      this.report = 0;
      this.port.postMessage({ db: Math.round(db), threshold: Math.round(threshold), open: this.open });
    }
    return true;
  }
}
registerProcessor('microphone-noise-gate', NoiseGate);
`

const modules = new WeakMap<AudioContext, Promise<void>>()
export async function createNoiseGateNode(context: AudioContext, settings: NoiseGateSettings): Promise<AudioWorkletNode> {
  let loading = modules.get(context)
  if (!loading) {
    const url = URL.createObjectURL(new Blob([noiseGateWorkletSource], { type: 'text/javascript' }))
    loading = context.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url))
    modules.set(context, loading)
    void loading.catch(() => modules.delete(context))
  }
  await loading
  return new AudioWorkletNode(context, 'microphone-noise-gate', {
    numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
    channelCount: 1, channelCountMode: 'explicit', processorOptions: settings,
  })
}
