const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const text = fs.readFileSync(path.join(__dirname, '../src/renderer/src/system-audio-processor.ts'), 'utf8')
const source = text.match(/export const pcmWorkletSource = `([\s\S]*)`/)[1]
let Processor
vm.runInNewContext(source, { Uint8Array, AudioWorkletProcessor: class { constructor() { this.port = {} } }, registerProcessor: (_name, value) => { Processor = value } })
const feed = (p, bytes) => p.port.onmessage({ data: Uint8Array.from(bytes).buffer })
function render(p, frames) {
  const output = [[new Float32Array(frames), new Float32Array(frames)]]
  assert.equal(p.process([], output), true)
  return output[0].map(a => Array.from(a))
}
const p = new Processor()
feed(p, [0, 128, 255])
assert.deepEqual(render(p, 1), [[0], [0]])
feed(p, [127, 0, 64, 0, 192])
assert.deepEqual(render(p, 3), [[-1, .5, 0], [32767 / 32768, -.5, 0]])
assert.equal(p.count, 0)
// Overflow drops whole oldest frames and keeps recent audio bounded to 200 ms.
const overflow = new Processor()
feed(overflow, new Uint8Array(overflow.buffer.length).fill(0))
feed(overflow, [0, 64, 0, 192])
assert.equal(overflow.count, overflow.buffer.length)
const recent = render(overflow, overflow.buffer.length / 4)
assert.equal(recent[0].at(-1), .5)
assert.equal(recent[1].at(-1), -.5)
// Exercise wrapping and byte-split stereo frames repeatedly.
const wrapped = new Processor()
for (let i=0;i<12000;i++) {
  feed(wrapped, [0,64,0]); feed(wrapped, [192]);
  assert.deepEqual(render(wrapped, 1), [[.5],[-.5]])
}
console.log('PASS PCM stereo decoding, split bytes, underrun silence, bounded overflow and ring wrapping')
