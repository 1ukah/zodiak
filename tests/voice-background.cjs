// The actual production window sends a deterministic fake microphone through
// RNNoise, the gate, and WebRTC to an independently scheduled receiver window.
const { app, BrowserWindow } = require('./silent-electron.cjs')
const { build } = require('./build-renderer.cjs')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { pathToFileURL } = require('node:url')
const root = path.resolve(__dirname, '..')
const temp = require('node:fs').mkdtempSync(path.join(os.tmpdir(), 'zodiak-voice-background-'))
app.setPath('userData', path.join(temp, 'profile'))
app.setPath('sessionData', path.join(temp, 'session'))
app.commandLine.appendSwitch('use-fake-device-for-media-stream')
app.commandLine.appendSwitch('use-fake-ui-for-media-stream')
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
app.commandLine.appendSwitch('use-file-for-fake-audio-capture', path.join(temp, 'microphone.wav'))
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
let sender, receiver
const timeout = setTimeout(() => { console.error('Background voice test timed out'); app.exit(1) }, 45000)
const senderSource = `
import { MicrophoneProcessor } from './microphone-processor'
import { Track } from 'livekit-client'
const peer = new RTCPeerConnection(), candidates = [];
peer.onicecandidate = event => { if(event.candidate) candidates.push(event.candidate.toJSON()) };
let context, stream, processor;
window.backgroundSender = {
  peer, candidates,
  async start() {
    stream = await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,sampleRate:48000,echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
    context = new AudioContext({sampleRate:48000,latencyHint:'interactive'});
    processor = new MicrophoneProcessor(context,.7,.8,{noiseGate:true,autoInputSensitivity:false,inputSensitivity:-70});
    await processor.init({kind:Track.Kind.Audio,track:stream.getAudioTracks()[0],audioContext:context});
    await processor.setNoiseSuppression(true);
    peer.addTrack(processor.processedTrack,new MediaStream([processor.processedTrack]));
    await peer.setLocalDescription(await peer.createOffer());
    return peer.localDescription.toJSON();
  },
  state() {return {rate:context.sampleRate,context:context.state,capture:stream.getAudioTracks()[0].readyState,processed:processor.processedTrack.readyState}},
  async stop() {peer.close();await processor.destroy();stream.getTracks().forEach(track=>track.stop());await context.close()}
};
`
const receiverSource = `
const peer = new RTCPeerConnection(), candidates = [];
peer.onicecandidate = event => {if(event.candidate)candidates.push(event.candidate.toJSON())};
let context, monitor, decoder, source;
const worklet = \`class Monitor extends AudioWorkletProcessor {
  constructor(){super();this.reset();this.port.onmessage=e=>{
    if(e.data==='reset')this.reset();
    else this.port.postMessage({samples:this.samples,crossings:this.crossings,energy:this.energy,zeroBlocks:this.zeroBlocks,blocks:this.blocks,rate:sampleRate});
  }}
  reset(){this.samples=0;this.crossings=0;this.energy=0;this.zeroBlocks=0;this.blocks=0;this.previous=0}
  process(inputs,outputs){const input=inputs[0][0];if(input){let energy=0;for(const value of input){energy+=value*value;if(this.previous<=0&&value>0)this.crossings++;this.previous=value}this.energy+=energy;this.samples+=input.length;this.blocks++;if(energy/input.length<1e-8)this.zeroBlocks++}return true}
};registerProcessor('voice-monitor',Monitor);\`;
let ready;const received=new Promise(resolve=>ready=resolve);
peer.ontrack=async event=>{
  decoder=document.createElement('audio');decoder.muted=true;decoder.srcObject=event.streams[0];await decoder.play();
  context=new AudioContext({sampleRate:48000});await context.resume();
  const url=URL.createObjectURL(new Blob([worklet],{type:'text/javascript'}));await context.audioWorklet.addModule(url);URL.revokeObjectURL(url);
  source=context.createMediaStreamSource(event.streams[0]);monitor=new AudioWorkletNode(context,'voice-monitor');source.connect(monitor).connect(context.destination);ready();
};
window.backgroundReceiver={peer,candidates,received,
  async offer(offer){await peer.setRemoteDescription(offer);await peer.setLocalDescription(await peer.createAnswer());return peer.localDescription.toJSON()},
  reset(){monitor.port.postMessage('reset')},
  read(){return new Promise(resolve=>{monitor.port.onmessage=e=>resolve(e.data);monitor.port.postMessage('read')})},
  async stop(){peer.close();decoder.pause();decoder.srcObject=null;source.disconnect();monitor.disconnect();await context.close()}
};
`
async function main() {
  await fs.mkdir(app.getPath('userData'), { recursive: true })
  await fs.writeFile(path.join(app.getPath('userData'),'config.json'), JSON.stringify({url:'ws://127.0.0.1:1',apiKey:'test',apiSecret:'test',displayName:'Background voice test',checkForUpdatesOnStartup:false}))
  const samples = 48000 * 4, wav = Buffer.alloc(44 + samples * 2)
  wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16)
  wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(48000,24);wav.writeUInt32LE(96000,28)
  wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*2,40)
  for(let i=0;i<samples;i++)wav.writeInt16LE(Math.round(.15*32767*Math.sin(2*Math.PI*440*i/48000)),44+i*2)
  await fs.writeFile(path.join(temp,'microphone.wav'),wav)
  const built = await build({stdin:{contents:senderSource,resolveDir:path.join(root,'src/renderer/src'),loader:'ts'},bundle:true,format:'iife',write:false})
  const shown = new Promise(resolve => app.on('browser-window-created',(_event,win)=>{
    if(win.getBounds().width!==360)win.once('show',()=>resolve(win))
  }))
  await import(pathToFileURL(path.join(root,'out/main/index.js')).href)
  sender = await shown
  console.log('Production sender ready')
  assert.equal(sender.webContents.getBackgroundThrottling(),false,'Exercise the real production background scheduling policy')
  // Optional comparison against the previous production policy. Passing this
  // comparison means this machine did not reproduce the reported glitch.
  if(process.argv.includes('--baseline-throttling')) {
    sender.webContents.setBackgroundThrottling(true)
    console.log('Baseline comparison: previous background throttling policy enabled')
  }
  await sender.webContents.executeJavaScript(built.outputFiles[0].text,true)
  receiver = new BrowserWindow({width:320,height:180,show:false,webPreferences:{backgroundThrottling:false}})
  receiver.webContents.on('console-message',event=>{if(event.level==='error')console.error('Receiver:',event.message)})
  await fs.writeFile(path.join(temp,'receiver.html'),'<title>Voice test receiver</title>')
  await receiver.loadFile(path.join(temp,'receiver.html'))
  await receiver.webContents.executeJavaScript(receiverSource + ';void 0',true)
  const tx = code => sender.webContents.executeJavaScript(code,true)
  const rx = code => receiver.webContents.executeJavaScript(code,true)
  const offer = await tx('window.backgroundSender.start()')
  console.log('Processed microphone acquired')
  const answer = await rx(`window.backgroundReceiver.offer(${JSON.stringify(offer)})`)
  await tx(`window.backgroundSender.peer.setRemoteDescription(${JSON.stringify(answer)})`)
  for(let attempt=0;attempt<10;attempt++) {
    const outgoing=await tx('window.backgroundSender.candidates.splice(0)')
    const incoming=await rx('window.backgroundReceiver.candidates.splice(0)')
    for(const candidate of outgoing)await rx(`window.backgroundReceiver.peer.addIceCandidate(${JSON.stringify(candidate)})`)
    for(const candidate of incoming)await tx(`window.backgroundSender.peer.addIceCandidate(${JSON.stringify(candidate)})`)
    await pause(50)
  }
  await rx('window.backgroundReceiver.received')
  console.log('Independent WebRTC receiver ready')
  await pause(1500) // Let RNNoise and the receive jitter buffer settle.
  for(const mode of ['focused','unfocused','minimized','hidden','restored']) {
    if(mode==='focused'||mode==='restored'){receiver.hide();sender.show();sender.restore();sender.focus()}
    if(mode==='unfocused'){receiver.show();receiver.focus();sender.blur()}
    if(mode==='minimized'){sender.minimize();assert(sender.isMinimized())}
    if(mode==='hidden'){sender.hide();assert(!sender.isVisible())}
    await pause(400)
    await rx('window.backgroundReceiver.reset()')
    const started=Date.now();await pause(2200)
    const stats=await rx('window.backgroundReceiver.read()'),elapsed=(Date.now()-started)/1000
    const frequency=stats.crossings*stats.rate/stats.samples, rms=Math.sqrt(stats.energy/stats.samples), clock=stats.samples/stats.rate/elapsed
    assert(Math.abs(frequency-440)<8,`${mode}: pitch changed: ${frequency} Hz`)
    assert(rms>.003,`${mode}: processed microphone went silent: ${rms}`)
    assert(stats.zeroBlocks/stats.blocks<.02,`${mode}: too many silent audio blocks: ${JSON.stringify(stats)}`)
    assert(clock>.9&&clock<1.1,`${mode}: audio clock drifted: ${clock}`)
    assert.deepEqual(await tx('window.backgroundSender.state()'),{rate:48000,context:'running',capture:'live',processed:'live'})
    console.log(`PASS ${mode}: transmitted pitch ${frequency.toFixed(1)} Hz, silent blocks ${(100*stats.zeroBlocks/stats.blocks).toFixed(2)}%, audio clock ${clock.toFixed(3)}`)
  }
  await tx('window.backgroundSender.stop()');await rx('window.backgroundReceiver.stop()')
  clearTimeout(timeout);receiver.destroy();sender.destroy();app.exit(0)
}
app.whenReady().then(main).catch(error=>{console.error(error);clearTimeout(timeout);receiver?.destroy();sender?.destroy();app.exit(1)})
