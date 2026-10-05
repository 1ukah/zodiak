const assert = require('node:assert/strict')
const vm = require('node:vm')
const path = require('node:path')
const { build } = require('./build-renderer.cjs')

async function main() {
  const built = await build({entryPoints:[path.join(__dirname,'../src/renderer/src/noise-gate.ts')],bundle:true,platform:'node',format:'cjs',write:false})
  const module = {exports:{}}
  vm.runInNewContext(built.outputFiles[0].text,{module,exports:module.exports,require})
  let Processor
  vm.runInNewContext(module.exports.noiseGateWorkletSource,{
    sampleRate:48000, AudioWorkletProcessor:class {constructor(){this.port={postMessage(){},close(){}}}},
    registerProcessor:(_name,ctor)=>{Processor=ctor},
  })
  let position=0
  function render(gate,amplitude,seconds) {
    const out = []
    for(let n=0;n<Math.ceil(seconds*48000/128);n++) {
      const input=Float32Array.from({length:128},()=>amplitude*Math.sin(2*Math.PI*440*position++/48000))
      const output=new Float32Array(128)
      assert.equal(gate.process([[input]],[[output]]),true)
      out.push(...output)
    }
    return out
  }
  const rms=signal=>Math.sqrt(signal.reduce((sum,x)=>sum+x*x,0)/signal.length)
  const gate=new Processor({processorOptions:{autoInputSensitivity:false,inputSensitivity:-40}})
  assert.equal(rms(render(gate,.002,1)),0,'Below-threshold noise must be exactly silent')
  const speech=render(gate,.1,.2)
  assert(rms(speech)>.06,'Above-threshold voice must pass at unity gain')
  const pause=render(gate,.002,.1)
  assert(rms(pause)>.001,'Hold time must preserve quiet syllables and short pauses')
  const tail=render(gate,.002,.5)
  assert.equal(rms(tail.slice(-4800)),0,'The gate must fully close after its hold and release')
  gate.port.onmessage({data:{autoInputSensitivity:false,inputSensitivity:-60}})
  assert(rms(render(gate,.002,.2))>.001,'Changing sensitivity must reopen the gate without replacing the track')
  gate.port.onmessage({data:{noiseGate:false}})
  assert(rms(render(gate,.0001,.2))>.00006,'Disabling the gate must pass quiet input')
  const automatic=new Processor({processorOptions:{}})
  const background=render(automatic,.01,3.5)
  assert.equal(rms(background.slice(-4800)),0,'Automatic sensitivity must learn steady background noise')
  assert(rms(render(automatic,.15,.2))>.09,'Voice must reopen the calibrated automatic gate')
  const bypass=new Processor({processorOptions:{noiseGate:false}})
  const input=Float32Array.from({length:4096},(_,i)=>i/8192)
  const output=new Float32Array(4096)
  bypass.process([[input]],[[output]])
  for(let i=1000;i<output.length;i++) assert.equal(output[i],input[i-480],'Lookahead must preserve sample order and unity gain')
  bypass.port.onmessage({data:'stop'})
  assert.equal(bypass.process([[input]],[[output]]),false)
  assert(output.every(x=>x===0),'Stopped worklets must terminate silently')
  console.log('PASS Gate thresholds, exact silence, speech opening, hold/release, live updates, automatic calibration, lookahead continuity, and shutdown')
}
main().catch(error=>{console.error(error);process.exitCode=1})
