// Production microphone processing/playback with a deterministic local audio source.
const { app, BrowserWindow } = require('./silent-electron.cjs')
const { build } = require('./build-renderer.cjs')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const root = path.resolve(__dirname, '..')
const temp = require('node:fs').mkdtempSync(path.join(os.tmpdir(), 'zodiak-loopback-'))
app.setPath('userData', path.join(temp, 'profile'))
app.setPath('sessionData', path.join(temp, 'session'))
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
app.commandLine.appendSwitch('use-fake-device-for-media-stream')
app.commandLine.appendSwitch('use-fake-ui-for-media-stream')
let win
const run = code => win.webContents.executeJavaScript(code, true)
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const timeout = setTimeout(() => { console.error('Microphone loopback test timed out'); app.exit(1) }, 45000)
const harness = `
import { MicrophoneLoopback } from './microphone-loopback'
const loopback=new MicrophoneLoopback();
const settings={inputDeviceId:'default',inputVolume:1,outputDeviceId:'default',outputVolume:1,noiseSuppression:false};
const NativeContext=window.AudioContext;const producer=new NativeContext({sampleRate:48000});
const contexts=[],captures=[],outputs=[],devices=[],captureOptions=[];let destination,holdMic=false,releaseMic,failMic=false,holdNoise=false,releaseNoise,realMic=false;
let nodesCreated=0,nodesStopped=0;
window.AudioContext=class extends NativeContext {constructor(...args){super(...args);contexts.push(this)}};
const NativeNode=window.AudioWorkletNode;
window.AudioWorkletNode=class extends NativeNode {constructor(context,name,options){super(context,name,options);if(name==='microphone-noise-suppression'){nodesCreated++;let stopped=false;const post=this.port.postMessage.bind(this.port);this.port.postMessage=(value,...args)=>{if(value==='stop'&&!stopped){stopped=true;nodesStopped++}return post(value,...args)}}}};
const addModule=AudioWorklet.prototype.addModule;
AudioWorklet.prototype.addModule=async function(...args){await addModule.apply(this,args);if(holdNoise)await new Promise(resolve=>releaseNoise=resolve)};
const acquire=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
navigator.mediaDevices.getUserMedia=async options=>{
  captureOptions.push(options.audio);
  if(failMic)throw Error('Permission denied');
  devices.push(options.audio.deviceId?.exact||'default');
  if(realMic){const stream=await acquire(options);captures.push(...stream.getTracks());return stream}
  if(!destination){
    await producer.resume();const buffer=producer.createBuffer(1,48000*4,48000);const data=buffer.getChannelData(0);let seed=1234;
    for(let i=0;i<data.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;data[i]=((seed/4294967296)*2-1)*.06}
    const source=producer.createBufferSource();source.buffer=buffer;source.loop=true;destination=producer.createMediaStreamDestination();source.connect(destination);source.start();
  }
  const stream=new MediaStream([destination.stream.getAudioTracks()[0].clone()]);captures.push(...stream.getTracks());
  if(holdMic)await new Promise(resolve=>releaseMic=resolve);
  return stream;
};
async function measure(){
  const stream=loopback.current.output.audio.srcObject;
  const context=new NativeContext();await context.resume();const source=context.createMediaStreamSource(stream);const analyser=context.createAnalyser();analyser.fftSize=2048;source.connect(analyser);
  await new Promise(resolve=>setTimeout(resolve,300));let total=0;
  for(let n=0;n<10;n++){const samples=new Float32Array(2048);analyser.getFloatTimeDomainData(samples);total+=Math.sqrt(samples.reduce((sum,sample)=>sum+sample*sample,0)/samples.length);await new Promise(resolve=>setTimeout(resolve,20))}
  source.disconnect();await context.close();return total/10;
}
window.loopbackTest={
  async start(){await loopback.start(settings);if(loopback.current?.output)outputs.push(...loopback.current.output.destination.stream.getTracks())},
  configure:changes=>{Object.assign(settings,changes);return loopback.configure(settings)},stop:()=>loopback.stop(),measure,
  holdMic(){holdMic=true},releaseMic(){holdMic=false;releaseMic()},failMic:value=>failMic=value,
  holdNoise(){holdNoise=true},releaseNoise(){holdNoise=false;releaseNoise()},realMic(){realMic=true;settings.inputDeviceId='default'},
  snapshot:()=>({active:loopback.active,liveCaptures:captures.filter(track=>track.readyState==='live').length,
    liveOutputs:outputs.filter(track=>track.readyState==='live').length,contexts:contexts.map(context=>context.state),
    elements:document.querySelectorAll('audio[data-voice-loopback]').length,playing:!!document.querySelector('audio[data-voice-loopback]')&&!document.querySelector('audio[data-voice-loopback]').paused,
    nodesCreated,nodesStopped,noiseLoading:!!releaseNoise,permissionLoading:!!releaseMic,devices,captureOptions,
    captureSettings:captures.filter(track=>track.readyState==='live').map(track=>track.getSettings())})
};
`
const snapshot = () => run('window.loopbackTest.snapshot()')
const stopped = async () => {
  await pause(100)
  const state = await snapshot()
  assert.equal(state.active, false)
  assert.equal(state.liveCaptures, 0)
  assert.equal(state.liveOutputs, 0)
  assert.equal(state.elements, 0)
  assert(state.contexts.every(value => value === 'closed'))
  assert.equal(state.nodesCreated, state.nodesStopped)
}
app.whenReady().then(async () => {
  await build({stdin:{contents:harness,resolveDir:path.join(root,'src/renderer/src'),loader:'ts'},bundle:true,format:'esm',outfile:path.join(temp,'main.js')})
  await fs.writeFile(path.join(temp,'index.html'),'<html><body><script type="module" src="./main.js"></script></body></html>')
  win=new BrowserWindow({show:false,webPreferences:{contextIsolation:false,sandbox:false,backgroundThrottling:false}})
  assert.equal(win.webContents.isAudioMuted(), true, 'Loopback tests must not play through the physical output')
  await win.loadFile(path.join(temp,'index.html'))
  await run('window.loopbackTest.start()')
  assert((await snapshot()).playing)
  assert.equal((await snapshot()).nodesCreated, 0)
  const raw = await run('window.loopbackTest.measure()')
  assert(raw > .01)
  await run('window.loopbackTest.configure({inputVolume:.5})')
  const half = await run('window.loopbackTest.measure()')
  assert(half > raw*.4 && half < raw*.6, JSON.stringify({raw,half}))
  await run('window.loopbackTest.configure({outputVolume:.5})')
  const quarter = await run('window.loopbackTest.measure()')
  assert(quarter > raw*.2 && quarter < raw*.3, JSON.stringify({raw,quarter}))
  await run('window.loopbackTest.configure({inputVolume:0})')
  assert(await run('window.loopbackTest.measure()') < .0001)
  await run('window.loopbackTest.configure({inputVolume:1,outputVolume:1,noiseSuppression:true})')
  await pause(1200)
  const filtered = await run('window.loopbackTest.measure()')
  assert(filtered < raw*.5, JSON.stringify({raw,filtered}))
  await run('window.loopbackTest.configure({suppressionStrength:1})')
  const strong=await run('window.loopbackTest.measure()')
  assert(strong<filtered*.8, 'Full strength must suppress more than the gentler default: '+JSON.stringify({filtered,strong}))
  await run('window.loopbackTest.configure({suppressionStrength:0})')
  assert.equal((await snapshot()).nodesCreated,(await snapshot()).nodesStopped,'Zero strength must stop RNNoise processing')
  assert(await run('window.loopbackTest.measure()')>raw*.75)
  await run('window.loopbackTest.configure({suppressionStrength:.75})')
  await run('window.loopbackTest.configure({noiseSuppression:false})')
  assert.equal((await snapshot()).nodesCreated, (await snapshot()).nodesStopped)
  assert(await run('window.loopbackTest.measure()') > raw*.75)
  console.log('PASS Local playback follows input/output volume, zero gain, and real RNNoise suppression; disabling suppression releases its worklet')
  await run('window.loopbackTest.configure({inputDeviceId:"second-mic",noiseSuppression:true})')
  let state = await snapshot()
  assert.equal(state.devices.at(-1), 'second-mic')
  assert.equal(state.liveCaptures, 1)
  assert.equal(state.contexts.filter(value => value !== 'closed').length, 1)
  assert(state.playing)
  await run('window.loopbackTest.stop()');await stopped()
  console.log('PASS Input-device changes replace capture; stopping releases capture, playback, every AudioContext, and RNNoise worklet')
  await run('window.loopbackTest.holdMic();window.startup=window.loopbackTest.start();void 0')
  for(let i=0;i<100&&!(await snapshot()).permissionLoading;i++)await pause(25)
  assert((await snapshot()).permissionLoading)
  await run('window.loopbackTest.stop();window.loopbackTest.releaseMic();window.startup')
  await stopped()
  await run('window.loopbackTest.holdNoise();window.startup=window.loopbackTest.start();void 0')
  for(let i=0;i<200&&!(await snapshot()).noiseLoading;i++)await pause(25)
  assert((await snapshot()).noiseLoading)
  const before = (await snapshot()).nodesCreated
  await run('window.loopbackTest.stop();window.loopbackTest.releaseNoise();window.startup')
  await stopped()
  assert.equal((await snapshot()).nodesCreated, before)
  console.log('PASS Stopping during microphone permission or RNNoise startup cancels late playback and leaves no live resources')
  await run('window.loopbackTest.failMic(true)')
  await assert.rejects(run('window.loopbackTest.start()'), /Permission denied/)
  await stopped()
  await run('window.loopbackTest.failMic(false);window.loopbackTest.start()')
  assert((await snapshot()).playing)
  await run('window.loopbackTest.stop()');await stopped()
  console.log('PASS Permission failure cleans up and allows a subsequent microphone test')
  await run('window.loopbackTest.realMic();window.loopbackTest.start()')
  assert.equal((await snapshot()).captureSettings.at(-1).echoCancellation,true)
  assert.equal((await snapshot()).captureSettings.at(-1).noiseSuppression,false)
  await run('window.loopbackTest.configure({noiseSuppression:false})')
  assert.equal((await snapshot()).captureSettings.at(-1).echoCancellation,true)
  assert.equal((await snapshot()).captureSettings.at(-1).noiseSuppression,false)
  assert((await snapshot()).captureOptions.every(options=>options.echoCancellation===true&&options.noiseSuppression===false), 'Every microphone acquisition must retain echo cancellation without native noise suppression')
  await run('window.loopbackTest.stop()');await stopped()
  console.log('PASS Chromium loopback capture enables echo cancellation and disables native suppression with RNNoise on and off')
  clearTimeout(timeout);win.destroy();app.exit(0)
}).catch(error => {console.error(error);clearTimeout(timeout);win?.destroy();app.exit(1)})
