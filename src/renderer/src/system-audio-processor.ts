// Fixed 200 ms PCM ring. Pipe chunks may split a stereo frame at any byte.
// Never allocate typed-array views inside the audio rendering callback.
export const pcmWorkletSource = `
class Pcm extends AudioWorkletProcessor {
  constructor() {
    super(); this.buffer = new Uint8Array(48000 * 4 / 5); this.read = 0; this.write = 0; this.count = 0;
    this.port.onmessage = event => {
      const bytes = new Uint8Array(event.data);
      for (let i = 0; i < bytes.length; i++) {
        if (this.count === this.buffer.length) {
          this.read = (this.read + 4) % this.buffer.length; this.count -= 4;
        }
        this.buffer[this.write] = bytes[i];
        this.write = (this.write + 1) % this.buffer.length; this.count++;
      }
    };
  }
  process(_, outputs) {
    const left = outputs[0][0], right = outputs[0][1], buffer = this.buffer;
    for (let i = 0; i < left.length; i++) {
      if (this.count < 4) { left[i] = right[i] = 0; continue; }
      const at = this.read;
      const l = buffer[at] | (buffer[at + 1] << 8), r = buffer[at + 2] | (buffer[at + 3] << 8);
      left[i] = (l >= 32768 ? l - 65536 : l) / 32768;
      right[i] = (r >= 32768 ? r - 65536 : r) / 32768;
      this.read = (at + 4) % buffer.length; this.count -= 4;
    }
    return true;
  }
}
registerProcessor('system-audio-pcm', Pcm);`
