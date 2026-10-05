// Verify frame continuity and actual WASM shutdown independently of the room.
const assert = require('node:assert/strict')
const vm = require('node:vm')
const path = require('node:path')
const { build } = require('./build-renderer.cjs')

async function main() {
  const built = await build({ entryPoints: [path.join(__dirname, '../src/renderer/src/noise-suppression.ts')], bundle: true, platform: 'node', format: 'cjs', write: false })
  const module = { exports: {} }
  vm.runInNewContext(built.outputFiles[0].text, { module, exports: module.exports, require })
  const source = module.exports.noiseWorkletSource.replace('import.meta.url', "'file:///rnnoise.js'").replace('export default createRNNWasmModuleSync;', '')
  let Processor
  const context = vm.createContext({
    WebAssembly, atob, setTimeout, clearTimeout, console, sampleRate: 48000,
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage() {}, close() {} } } },
    registerProcessor: (_name, constructor) => { Processor = constructor },
  })
  vm.runInContext(source, context)
  const real = new Processor()
  assert(real.state && real.pointer && real.module, 'A real RNNoise instance must allocate its state')
  const output = new Float32Array(128)
  assert.equal(real.process([[new Float32Array(128)]], [[output]]), true)
  real.port.onmessage({ data: 'stop' })
  assert.equal(real.state, 0)
  assert.equal(real.pointer, 0)
  assert.equal(real.module, null, 'Stopping must release the WASM module reference as well as native state')
  assert.equal(real.process([[new Float32Array(128)]], [[output]]), false, 'A stopped worklet must cease processing')
  assert(output.every(sample => sample === 0))
  console.log('PASS Actual RNNoise WASM state is released and processing terminates on stop')

  // Measure the embedded model's real delay before allowing any original/
  // processed mix. A mismatched delay would produce comb filtering or echo.
  const full = new Processor(), gentle = new Processor({processorOptions:{strength:.75}})
  const inputSignal=new Float32Array(32768), fullSignal=new Float32Array(32768), gentleSignal=new Float32Array(32768)
  let seed=1234
  for(let i=0;i<inputSignal.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;inputSignal[i]=(seed/4294967296*2-1)*.06}
  for(let offset=0;offset<inputSignal.length;offset+=128){const input=inputSignal.subarray(offset,offset+128);full.process([[input]],[[fullSignal.subarray(offset,offset+128)]]);gentle.process([[input]],[[gentleSignal.subarray(offset,offset+128)]])}
  let bestDelay=0,bestCorrelation=-Infinity
  for(let delay=0;delay<=2000;delay++){let correlation=0;for(let i=4000;i<inputSignal.length;i++)correlation+=fullSignal[i]*inputSignal[i-delay];if(correlation>bestCorrelation){bestCorrelation=correlation;bestDelay=delay}}
  assert.equal(bestDelay,1440,'The original signal must be aligned to the embedded RNNoise model plus frame adapter')
  for(let i=0;i<inputSignal.length;i++){const original=i<1440?0:inputSignal[i-1440];assert(Math.abs(gentleSignal[i]-(.75*fullSignal[i]+.25*original))<1e-8,'Gentler suppression must retain the aligned original signal')}
  full.port.onmessage({data:'stop'});gentle.port.onmessage({data:'stop'})
  console.log('PASS Actual RNNoise delay is 1440 samples; gentler processing mixes aligned audio without a second delayed copy')

  // An identity DSP isolates the buffer adapter: every sample must emerge once,
  // in order, after exactly 480 samples, across changing render block sizes.
  vm.runInContext(`createRNNWasmModuleSync = () => ({
    HEAPF32: new Float32Array(481), _rnnoise_create: () => 1,
    _malloc: () => 4, _rnnoise_destroy() {}, _free() {}, _rnnoise_process_frame() {},
  })`, context)
  const adapter = new Processor()
  let sampleIndex = 0
  for (let block = 0; block < 100; block++) {
    const count = [128, 256, 96, 480][block % 4]
    const input = Float32Array.from({ length: count }, (_, index) => (sampleIndex + index + 1) / 65536)
    const out = new Float32Array(count)
    adapter.process([[input]], [[out]])
    for (let index = 0; index < count; index++) {
      const delayed = sampleIndex + index - 480
      assert.equal(out[index], delayed < 0 ? 0 : (delayed + 1) / 65536, 'The frame adapter must not lose, duplicate, or reorder samples')
    }
    sampleIndex += count
  }
  adapter.port.onmessage({ data: 'stop' })
  console.log('PASS Frame adapter maintains continuous audio across render block and RNNoise frame boundaries')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
