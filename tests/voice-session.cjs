// Production voice component with real WebRTC audio and Chromium's fake microphone.
const { app, BrowserWindow } = require('./silent-electron.cjs')
const { build } = require('./build-renderer.cjs')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const root = path.resolve(__dirname, '..')
const temp = require('node:fs').mkdtempSync(path.join(os.tmpdir(), 'zodiak-voice-session-'))
app.setPath('userData', path.join(temp, 'profile'))
app.setPath('sessionData', path.join(temp, 'session'))
app.commandLine.appendSwitch('use-fake-device-for-media-stream')
app.commandLine.appendSwitch('use-fake-ui-for-media-stream')
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
let win
const run = code => win.webContents.executeJavaScript(code, true)
const timeout = setTimeout(() => { console.error('Voice session test timed out'); app.exit(1) }, 60000)
const harness = `
import { RoomVoice } from './voice'
import { ConnectionState, LocalAudioTrack, RemoteAudioTrack, RoomEvent, Track, setLogLevel, LogLevel } from 'livekit-client'
setLogLevel(LogLevel.error)
const listeners = new Map(); const states = []; let pub; let failMic = false; let failDevice = false; let hold = false; let release;
const captured = []; const captureOptions = []; const subscriptions = []; const tx = new AudioContext(); const peers = [];
let noiseNodesCreated=0, noiseNodesStopped=0, holdNoise=false, releaseNoise;
const NativeWorkletNode=window.AudioWorkletNode;
window.AudioWorkletNode=class extends NativeWorkletNode {
  constructor(context,name,options){
    super(context,name,options);
    if(name==='microphone-noise-suppression'){
      noiseNodesCreated++;let stopped=false;const post=this.port.postMessage.bind(this.port);
      this.port.postMessage=(message,...args)=>{if(message==='stop'&&!stopped){stopped=true;noiseNodesStopped++}return post(message,...args)};
    }
  }
};
const addModule=AudioWorklet.prototype.addModule;
AudioWorklet.prototype.addModule=async function(...args){await addModule.apply(this,args);if(holdNoise)await new Promise(resolve=>{releaseNoise=resolve})};
const local = {identity:'me', attributes:{}, getTrackPublication(){return pub},
  async setAttributes(value){Object.assign(this.attributes,value)},
  async createTracks({audio:options}) {
    const media=await navigator.mediaDevices.getUserMedia({audio:options});
    const track=new LocalAudioTrack(media.getAudioTracks()[0],options,false);track.source=Track.Source.Microphone;
    return [track];
  },
  async publishTrack(track,options) {
    track.stopOnMute=options.stopMicTrackOnMute;
    pub={track,get isMuted(){return track.isMuted}};
    room.emit(RoomEvent.LocalTrackPublished);return pub;
  },
  async unpublishTrack(track){track.stop();pub=undefined;room.emit(RoomEvent.LocalTrackUnpublished)}
};
const room={state:ConnectionState.Connected,localParticipant:local,remoteParticipants:new Map(),
  on(event, fn){if(!listeners.has(event))listeners.set(event,new Set());listeners.get(event).add(fn);return this},
  off(event, fn){listeners.get(event)?.delete(fn);return this},
  emit(event){for(const fn of listeners.get(event)||[])fn()},
  async switchActiveDevice(kind,id){if(failDevice)throw Error('Device unplugged');if(pub)await pub.track.setDeviceId(id);return true}
};
let voice; let blocked = false;
function setup(enabled=true,participantVolumes={}){voice?.close();pub=undefined;voice=new RoomVoice(room,document.body,{enabled,inputDeviceId:'default',noiseSuppression:false,participantVolumes},state=>states.push(state),value=>{blocked=value});return voice.start()}
async function addRemote(id, source=Track.Source.Microphone) {
  await tx.resume(); const oscillator=tx.createOscillator(); const gain=tx.createGain(); gain.gain.value=0;
  const destination=tx.createMediaStreamDestination(); oscillator.connect(gain).connect(destination);oscillator.start();
  const sender=new RTCPeerConnection(), receiver=new RTCPeerConnection();peers.push(sender,receiver);
  sender.onicecandidate=e=>{if(e.candidate)void receiver.addIceCandidate(e.candidate)};
  receiver.onicecandidate=e=>{if(e.candidate)void sender.addIceCandidate(e.candidate)};
  const received=new Promise(resolve=>{receiver.ontrack=resolve}); sender.addTrack(destination.stream.getAudioTracks()[0],destination.stream);
  await sender.setLocalDescription(await sender.createOffer());await receiver.setRemoteDescription(sender.localDescription);
  await receiver.setLocalDescription(await receiver.createAnswer());await sender.setRemoteDescription(receiver.localDescription);
  const event=await received; const track=new RemoteAudioTrack(event.track,'audio-'+id,event.receiver);track.source=source;
  const publication={track,isMuted:false,isDesired:false,setSubscribed(value){this.isDesired=value;subscriptions.push([id,value])}};
  const participant={identity:id,attributes:{'zodiak.voice.enabled':'true'},getTrackPublication(request){return request===source?publication:undefined}};
  room.remoteParticipants.set(id,participant);room.emit(RoomEvent.TrackPublished);room.emit(RoomEvent.TrackSubscribed);
  return {gain,publication,participant};
}
const acquire=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
let toneCapture=false; let noiseCapture=false; let noiseDestination; let inputDestination;
navigator.mediaDevices.getUserMedia=async options=>{
  captureOptions.push(structuredClone(options.audio));
  if(failMic)throw Error('Permission denied');
  let media;
  if(noiseCapture){
    if(!noiseDestination){
      await tx.resume();const buffer=tx.createBuffer(1,tx.sampleRate*4,tx.sampleRate);const data=buffer.getChannelData(0);let seed=1234;
      for(let i=0;i<data.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;data[i]=((seed/4294967296)*2-1)*.06}
      const source=tx.createBufferSource();source.buffer=buffer;source.loop=true;noiseDestination=tx.createMediaStreamDestination();source.connect(noiseDestination);source.start();
    }
    media=new MediaStream([noiseDestination.stream.getAudioTracks()[0].clone()]);
  }else if(toneCapture){
    if(!inputDestination){await tx.resume();const oscillator=tx.createOscillator();const gain=tx.createGain();gain.gain.value=.08;inputDestination=tx.createMediaStreamDestination();oscillator.connect(gain).connect(inputDestination);oscillator.start()}
    media=new MediaStream([inputDestination.stream.getAudioTracks()[0].clone()]);
  }else media=await acquire(options);
  // Web Audio tracks have no capture constraints; emulate hardware tracks so
  // LiveKit can retain the requested processing settings on mute/unmute.
  if(noiseCapture||toneCapture){const constraints=structuredClone(options.audio);for(const track of media.getTracks())track.getConstraints=()=>structuredClone(constraints)}
  captured.push(...media.getTracks());
  if(hold)await new Promise(resolve=>{release=resolve});
  return media;
};
async function rms(stream) {
  const context=new AudioContext();await context.resume();const source=context.createMediaStreamSource(stream);const analyser=context.createAnalyser();analyser.fftSize=2048;source.connect(analyser);
  await new Promise(resolve=>setTimeout(resolve,300));let total=0;
  for(let n=0;n<10;n++){const samples=new Float32Array(2048);analyser.getFloatTimeDomainData(samples);total+=Math.sqrt(samples.reduce((sum,sample)=>sum+sample*sample,0)/samples.length);await new Promise(resolve=>setTimeout(resolve,20))}
  source.disconnect();await context.close();return total/10;
}
async function inputStream() {
  const sender=new RTCPeerConnection(), receiver=new RTCPeerConnection();peers.push(sender,receiver);
  sender.onicecandidate=e=>{if(e.candidate)void receiver.addIceCandidate(e.candidate)};
  receiver.onicecandidate=e=>{if(e.candidate)void sender.addIceCandidate(e.candidate)};
  const received=new Promise(resolve=>{receiver.ontrack=resolve});
  const stream=new MediaStream([pub.track.mediaStreamTrack]);pub.track.sender=sender.addTrack(pub.track.mediaStreamTrack,stream);
  await sender.setLocalDescription(await sender.createOffer());await receiver.setRemoteDescription(sender.localDescription);
  await receiver.setLocalDescription(await receiver.createAnswer());await sender.setRemoteDescription(receiver.localDescription);
  const event=await received;const decoder=document.createElement('audio');decoder.muted=true;decoder.srcObject=event.streams[0];await decoder.play();
  return event.streams[0];
}
const remotes = new Map();
window.voiceTest={setup, async add(id,source){remotes.set(id,await addRemote(id,source))},
  inputVolume:value=>voice.setInputVolume(value),outputVolume:value=>voice.setOutputVolume(value),
  measureOutput:(id='bob')=>rms(voice.audio.get(id).element.srcObject),
  async beginInputMeasure(){toneCapture=true;await voice.configure({enabled:false,inputDeviceId:'default'});await voice.configure({enabled:true,inputDeviceId:'default'});await voice.setMuted(false);window.inputSignal=await inputStream()},
  measureInput:()=>rms(window.inputSignal),
  async beginNoiseMeasure(){noiseCapture=true;await voice.configure({enabled:false,inputDeviceId:'default',noiseSuppression:false});await voice.configure({enabled:true,inputDeviceId:'default'});await voice.setMuted(false);window.inputSignal=await inputStream()},
  noise:enabled=>voice.configure({enabled:voice.enabled,inputDeviceId:'default',noiseSuppression:enabled}),
  restartInput:()=>pub.track.restartTrack(),
  holdNoise(){holdNoise=true},startNoise(){window.noiseStartup=voice.configure({enabled:true,inputDeviceId:'default',noiseSuppression:true})},
  releaseNoise(){holdNoise=false;releaseNoise?.()},
  volume(id,value){remotes.get(id).gain.gain.value=value}, muted:set=>voice.setMuted(set),deafened:set=>voice.setDeafened(set),
  configure:(enabled,inputDeviceId='default')=>voice.configure({enabled,inputDeviceId}),
  testing:active=>voice.setTesting(active),strength:value=>voice.configure({enabled:voice.enabled,inputDeviceId:'default',suppressionStrength:value}),
  localMute:(id,value)=>voice.setParticipantMuted(id,value),
  participantVolume:(id,value)=>voice.setParticipantVolume(id,value),
  remove(id){room.remoteParticipants.delete(id);room.emit(RoomEvent.ParticipantDisconnected)},
  remoteState(id,attrs,muted){Object.assign(remotes.get(id).participant.attributes,attrs);remotes.get(id).publication.isMuted=muted;room.emit(RoomEvent.ParticipantAttributesChanged);room.emit(RoomEvent.TrackMuted)},
  failMic(value){failMic=value}, failDevice(value){failDevice=value}, hold(){hold=true}, release(){hold=false;release?.()},
  startUnmute(){window.unmute=voice.setMuted(false).catch(error=>error.message)},close(){voice.close()},
  reconnect(){room.emit(RoomEvent.Reconnected)},resume:()=>voice.resume(),
  snapshot(){return {state:states.at(-1), attributes:local.attributes,subscriptions,inputDeviceId:voice.inputDeviceId,
    elements:[...voice.audio].map(([id,{element,receiver}])=>({id,muted:element.muted,playing:!element.paused,receiverMuted:receiver.muted,receiverVolume:receiver.volume})),
    activeCaptures:[...new Set(captured)].filter(track=>track.readyState==='live').length,
    captureOptions,captureSettings:captured.filter(track=>track.readyState==='live').map(track=>track.getSettings()),
    noiseActive:!!voice.inputGain?.noise,noiseNodesCreated,noiseNodesStopped,noiseLoading:!!releaseNoise,blocked}}
};
`
app.whenReady().then(async () => {
  await build({entryPoints:[path.join(root,'src/main/config.ts')],bundle:true,platform:'node',format:'cjs',external:['electron'],outfile:path.join(temp,'config.cjs')})
  const config = require(path.join(temp,'config.cjs'))
  assert.equal((await config.loadConfig()).voiceEnabled,true)
  assert.equal((await config.loadConfig()).voiceInputDeviceId,'default')
  assert.equal((await config.loadConfig()).voiceInputVolume,1)
  assert.equal((await config.loadConfig()).voiceNoiseSuppression,true)
  assert.equal((await config.loadConfig()).voiceSuppressionStrength,.8)
  await config.saveConfig({url:'ws://localhost:7880',apiKey:'test',apiSecret:'test',voiceEnabled:false,voiceInputDeviceId:'usb-mic',voiceInputVolume:.35,voiceNoiseSuppression:true,chatPosition:'bottom'})
  assert.equal((await config.loadConfig()).voiceEnabled,false)
  assert.equal((await config.loadConfig()).voiceInputDeviceId,'usb-mic')
  assert.equal((await config.loadConfig()).voiceInputVolume,.35)
  assert.equal((await config.loadConfig()).voiceNoiseSuppression,true)
  assert.equal(config.validateConfig({url:'ws://localhost:7880',apiKey:'test',apiSecret:'test',voiceNoiseSuppression:'true'}).voiceNoiseSuppression,true)
  await config.saveConfig({...await config.loadConfig(),voiceNoiseSuppression:false})
  assert.equal((await config.loadConfig()).voiceNoiseSuppression,false,'Save must remember an explicit choice to turn suppression off')
  await config.saveConfig({...await config.loadConfig(),voiceSuppressionStrength:.4})
  assert.equal((await config.loadConfig()).voiceSuppressionStrength,.4,'Save must remember suppression strength')
  assert.equal(config.validateConfig({...await config.loadConfig(),voiceSuppressionStrength:2}).voiceSuppressionStrength,1)
  assert.equal(config.validateConfig({...await config.loadConfig(),voiceSuppressionStrength:NaN}).voiceSuppressionStrength,.8)
  assert(!('chatPosition' in await config.loadConfig()))
  assert.equal(config.validateConfig({url:'ws://localhost:7880',apiKey:'test',apiSecret:'test',voiceInputVolume:-5}).voiceInputVolume,0)
  assert.equal(config.validateConfig({url:'ws://localhost:7880',apiKey:'test',apiSecret:'test',voiceInputVolume:NaN}).voiceInputVolume,1)
  await fs.writeFile(path.join(app.getPath('userData'),'config.json'),JSON.stringify({url:'ws://localhost:7880',apiKey:'test',apiSecret:'test'}))
  assert.equal((await config.loadConfig()).voiceEnabled,true)
  assert.equal((await config.loadConfig()).voiceInputDeviceId,'default')
  assert.equal((await config.loadConfig()).voiceNoiseSuppression,true)
  console.log('PASS Voice settings survive reload; legacy configurations default to enabled voice and the Windows default microphone')
  await build({stdin:{contents:harness,resolveDir:path.join(root,'src/renderer/src'),loader:'ts'},bundle:true,format:'iife',outfile:path.join(temp,'main.js')})
  await fs.writeFile(path.join(temp,'index.html'), '<!doctype html><script src="./main.js"></script>')
  win = new BrowserWindow({show:false,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}})
  assert.equal(win.webContents.isAudioMuted(),true, 'Voice tests must not play through the physical output')
  await win.loadFile(path.join(temp,'index.html'))
  const snapshot = () => run('window.voiceTest.snapshot()')
  await run('window.voiceTest.setup()')
  assert.equal((await snapshot()).activeCaptures,0)
  assert.equal((await snapshot()).state.muted,true)
  await run('window.voiceTest.muted(false)')
  assert.equal((await snapshot()).captureSettings.at(-1).echoCancellation,true)
  assert.equal((await snapshot()).captureSettings.at(-1).noiseSuppression,false)
  await run('window.voiceTest.noise(true);window.voiceTest.restartInput()')
  assert.equal((await snapshot()).captureSettings.at(-1).echoCancellation,true)
  assert.equal((await snapshot()).captureSettings.at(-1).noiseSuppression,false)
  await run('window.voiceTest.noise(false);window.voiceTest.muted(true)')
  console.log('PASS Chromium room capture enables echo cancellation and disables native suppression, including with RNNoise enabled and after microphone restart')
  // Give the pending-module cancellation fixture a fresh AudioContext.
  await run('window.voiceTest.setup()')
  await run("window.voiceTest.add('bob');window.voiceTest.add('screen', 'screen_share_audio')")
  await new Promise(resolve=>setTimeout(resolve,500))
  assert.deepEqual((await snapshot()).elements.map(el=>el.id),['bob'])
  assert((await snapshot()).elements[0].playing)
  assert((await snapshot()).elements[0].receiverMuted, 'The WebRTC decoder must stay muted so voice has only one audible path')
  assert.equal((await snapshot()).elements[0].receiverVolume,0, 'The decoder must also have zero volume')
  assert(!(await snapshot()).subscriptions.some(([id])=>id==='screen'))
  console.log('PASS Room voice subscribes and plays microphones without subscribing to screen audio or opening the local microphone')
  await run("window.voiceTest.volume('screen',.1)")
  await new Promise(resolve=>setTimeout(resolve,400))
  assert(!(await snapshot()).state.participants.some(person=>person.speaking))
  await run("window.voiceTest.volume('bob',.1)")
  await new Promise(resolve=>setTimeout(resolve,650))
  assert((await snapshot()).state.participants.find(person=>person.id==='bob').speaking)
  const outputFull=await run('window.voiceTest.measureOutput()');assert(outputFull>.02)
  await run('window.voiceTest.outputVolume(.5)');const outputHalf=await run('window.voiceTest.measureOutput()');
  assert(Math.abs(outputHalf/outputFull-.5)<.12, 'Voice output at 50% must halve the actual samples')
  await run('window.voiceTest.outputVolume(2)');const outputDouble=await run('window.voiceTest.measureOutput()');
  assert(Math.abs(outputDouble/outputFull-2)<.2, 'Voice output at 200% must double the actual samples')
  await run('window.voiceTest.outputVolume(0)');assert(await run('window.voiceTest.measureOutput()')<.00001)
  await new Promise(resolve=>setTimeout(resolve,1000))
  assert((await snapshot()).elements.every(element=>element.receiverMuted&&element.receiverVolume===0), 'Raw WebRTC receivers must not bypass zero processed volume')
  await run('window.voiceTest.outputVolume(1)')
  await new Promise(resolve=>setTimeout(resolve,400))
  assert(await run('window.voiceTest.measureOutput()')>.02, 'Restoring voice volume must restore the processed signal')
  console.log('PASS Voice output slider changes actual decoded audio at 0%, 50%, 100%, and 200%')
  await run("window.voiceTest.add('alice')")
  await run("window.voiceTest.volume('alice',.1);window.voiceTest.participantVolume('bob',.3)")
  assert.equal((await snapshot()).state.participants.find(person=>person.id==='bob').volume,.3)
  assert.equal((await snapshot()).state.participants.find(person=>person.id==='alice').volume,1)
  const individual=await run('window.voiceTest.measureOutput()')
  assert(Math.abs(individual/outputFull-.3)<.1,'Participant volume must reduce the actual decoded voice samples')
  await run('window.voiceTest.outputVolume(.5)')
  assert(Math.abs(await run('window.voiceTest.measureOutput()')/outputFull-.15)<.07,'Individual voice volume must multiply the global output setting')
  await run("window.voiceTest.localMute('bob',true);window.voiceTest.localMute('bob',false)")
  await run('window.voiceTest.deafened(true)')
  await run('window.voiceTest.deafened(false)')
  await run('window.voiceTest.reconnect()')
  assert.equal((await snapshot()).state.participants.find(person=>person.id==='bob').volume,.3)
  assert(Math.abs(await run('window.voiceTest.measureOutput()')/outputFull-.15)<.07,'Individual volume survives mute, deafen, track reattachment, and reconnect')
  await run("window.voiceTest.participantVolume('bob',NaN)")
  assert.equal((await snapshot()).state.participants.find(person=>person.id==='bob').volume,.3)
  await run("window.voiceTest.participantVolume('bob',-1)")
  assert.equal((await snapshot()).state.participants.find(person=>person.id==='bob').volume,0)
  assert(await run('window.voiceTest.measureOutput()')<.00001,'Zero participant volume must silence the processed signal')
  assert(await run("window.voiceTest.measureOutput('alice')")>.01,'Silencing one participant must keep the other participant audible')
  await run("window.voiceTest.participantVolume('bob',2);window.voiceTest.participantVolume('alice',.25);window.voiceTest.remove('alice');window.voiceTest.add('alice')")
  assert.equal((await snapshot()).state.participants.find(person=>person.id==='bob').volume,1)
  assert.equal((await snapshot()).state.participants.find(person=>person.id==='alice').volume,.25,'Departure and rejoining must preserve individual volume')
  await run("window.voiceTest.remove('alice');window.voiceTest.outputVolume(1)")
  console.log('PASS Individual voice volume changes decoded samples independently, combines with global gain, and survives departure and reattachment')
  await run("window.voiceTest.localMute('bob',true)")
  assert((await snapshot()).elements[0].muted)
  assert((await snapshot()).state.participants.find(person=>person.id==='bob').locallyMuted)
  assert(!(await snapshot()).state.participants.find(person=>person.id==='bob').speaking)
  await run('window.voiceTest.outputVolume(.5)')
  await run('window.voiceTest.resume()')
  assert(await run('window.voiceTest.measureOutput()')<.00001, 'Changing volume and resuming must preserve local mute')
  await new Promise(resolve=>setTimeout(resolve,1000))
  assert((await snapshot()).elements.every(element=>element.muted&&element.receiverMuted&&element.receiverVolume===0), 'Participant mute must mute every playback path, even after resuming audio')
  await run("window.voiceTest.localMute('bob',false)")
  await new Promise(resolve=>setTimeout(resolve,400))
  assert.equal((await snapshot()).elements[0].muted,false, 'Participant unmute must restore the processed playback element')
  assert(Math.abs(await run('window.voiceTest.measureOutput()')/outputFull-.5)<.12, 'Unmute must restore the selected output volume')
  await run('window.voiceTest.outputVolume(1)')
  await run("window.voiceTest.localMute('bob',false);window.voiceTest.volume('bob',0)")
  await new Promise(resolve=>setTimeout(resolve,650))
  assert(!(await snapshot()).state.participants.find(person=>person.id==='bob').speaking)
  console.log('PASS Speaking follows microphone audio, ignores screen audio, clears after silence, and local mute silences only the selected voice')
  await run('window.voiceTest.beginInputMeasure()')
  const inputFull=await run('window.voiceTest.measureInput()');assert(inputFull>.02)
  await run('window.voiceTest.inputVolume(.5)');const inputHalf=await run('window.voiceTest.measureInput()');
  assert(Math.abs(inputHalf/inputFull-.5)<.15, 'Microphone at 50% must halve the transmitted audio')
  await run('window.voiceTest.inputVolume(0)');assert(await run('window.voiceTest.measureInput()')<.0001)
  await run('window.voiceTest.muted(true)');await run('window.voiceTest.muted(false)');assert(await run('window.voiceTest.measureInput()')<.0001)
  await run('window.voiceTest.inputVolume(1)');assert(await run('window.voiceTest.measureInput()')>.02)
  await run('window.voiceTest.testing(true)')
  let testingState=await snapshot()
  assert(testingState.state.muted&&testingState.state.deafened)
  assert(testingState.state.participants.find(person=>person.id==='me').deafened)
  assert.equal(testingState.activeCaptures,0)
  assert.equal(testingState.elements.length,0)
  assert.equal(testingState.attributes['zodiak.voice.deafened'],'true')
  await run('window.voiceTest.testing(false)')
  assert.equal((await snapshot()).state.muted,false)
  assert.equal((await snapshot()).state.deafened,false)
  await run('window.voiceTest.muted(true);window.voiceTest.testing(true);window.voiceTest.testing(false)')
  assert.equal((await snapshot()).state.muted,true)
  await run('window.voiceTest.muted(false);window.voiceTest.deafened(true);window.voiceTest.testing(true);window.voiceTest.testing(false)')
  assert.equal((await snapshot()).state.deafened,true)
  await run('window.voiceTest.deafened(false)')
  console.log('PASS Local microphone testing stops capture/reception and advertises muted/deafened status while preserving prior mute/deafen choices')
  await run('window.voiceTest.muted(true);window.voiceTest.muted(false)');assert(await run('window.voiceTest.measureInput()')>.02)
  console.log('PASS Input gain changes actual transmitted WebRTC audio; zero remains silent through mute/unmute and restoring 100% restores audio')
  await run('window.voiceTest.beginNoiseMeasure()')
  const rawNoise=await run('window.voiceTest.measureInput()');assert(rawNoise>.01)
  const nodesBefore=(await snapshot()).noiseNodesCreated
  await run('window.voiceTest.holdNoise();window.voiceTest.startNoise();void 0')
  for(let i=0;i<200&&!(await snapshot()).noiseLoading;i++)await new Promise(resolve=>setTimeout(resolve,25))
  assert((await snapshot()).noiseLoading,'The first noise module load must reach the held startup')
  await run('window.noiseDisable=window.voiceTest.noise(false);void 0')
  await run('window.voiceTest.releaseNoise();window.noiseDisable;window.noiseStartup')
  assert.equal((await snapshot()).noiseNodesCreated,nodesBefore,'Disabling during module loading must prevent WASM worklet creation')
  await run('window.voiceTest.noise(true)')
  assert((await snapshot()).noiseActive)
  await new Promise(resolve=>setTimeout(resolve,1200))
  const filteredNoise=await run('window.voiceTest.measureInput()')
  assert(filteredNoise<rawNoise*.5,'RNNoise must reduce real noise sent through WebRTC by at least half: '+JSON.stringify({rawNoise,filteredNoise}))
  await run('window.voiceTest.inputVolume(0)');assert(await run('window.voiceTest.measureInput()')<.0001)
  await run('window.voiceTest.inputVolume(1);window.voiceTest.noise(false)')
  assert.equal((await snapshot()).noiseActive,false)
  assert.equal((await snapshot()).noiseNodesCreated,(await snapshot()).noiseNodesStopped,'Unchecked suppression must release every worklet')
  assert(await run('window.voiceTest.measureInput()')>rawNoise*.75,'Disabling must restore the unfiltered microphone')
  await run('window.voiceTest.noise(true);window.voiceTest.muted(true)')
  assert.equal((await snapshot()).noiseActive,false)
  const mutedNodes=(await snapshot()).noiseNodesCreated
  await run('window.voiceTest.noise(true)')
  assert.equal((await snapshot()).noiseNodesCreated,mutedNodes,'Enabling while muted must not start the filter')
  await run('window.voiceTest.muted(false)');assert((await snapshot()).noiseActive)
  await run('window.voiceTest.deafened(true)');assert.equal((await snapshot()).noiseActive,false)
  await run('window.voiceTest.deafened(false)');assert((await snapshot()).noiseActive)
  const nodesBeforeRestart=(await snapshot()).noiseNodesCreated
  await run('window.voiceTest.restartInput()');assert((await snapshot()).noiseActive)
  assert.equal((await snapshot()).noiseNodesCreated,nodesBeforeRestart+1,'SDK microphone restart must rebuild the active denoiser')
  await run('window.voiceTest.configure(true,"default")');assert((await snapshot()).noiseActive)
  await run('window.voiceTest.configure(false)');assert.equal((await snapshot()).noiseActive,false)
  const disabledNodes=(await snapshot()).noiseNodesCreated
  await run('window.voiceTest.noise(true)');assert.equal((await snapshot()).noiseNodesCreated,disabledNodes)
  assert.equal((await snapshot()).noiseNodesCreated,(await snapshot()).noiseNodesStopped)
  await run('window.voiceTest.configure(true)')
  await run('window.voiceTest.muted(false)')
  await run('window.voiceTest.noise(false)')
  console.log('PASS Real RNNoise suppresses transmitted noise, preserves zero gain, cancels pending startup, and releases worklets on disable/mute/deafen')
  await run('window.voiceTest.muted(false)')
  assert.equal((await snapshot()).activeCaptures,1)
  await run('window.voiceTest.deafened(true)')
  assert.equal((await snapshot()).activeCaptures,0)
  assert.equal((await snapshot()).elements.length,0)
  assert.equal((await snapshot()).attributes['zodiak.voice.deafened'],'true')
  await run('window.voiceTest.deafened(false)')
  assert.equal((await snapshot()).state.muted,false)
  assert.equal((await snapshot()).activeCaptures,1)
  await run('window.voiceTest.muted(true);window.voiceTest.deafened(true);window.voiceTest.deafened(false)')
  assert.equal((await snapshot()).state.muted,true)
  assert.equal((await snapshot()).activeCaptures,0)
  console.log('PASS Deafen stops capture and voice reception; undeafen restores both previously muted and previously unmuted microphone states')
  await run("window.voiceTest.remoteState('bob',{'zodiak.voice.deafened':'true'},true)")
  assert((await snapshot()).state.participants.find(person=>person.id==='bob').deafened)
  await run('window.voiceTest.configure(false)')
  assert.equal((await snapshot()).elements.length,0)
  assert.equal((await snapshot()).attributes['zodiak.voice.enabled'],'false')
  await run('window.voiceTest.configure(true);window.voiceTest.reconnect()')
  await new Promise(resolve=>setTimeout(resolve,100))
  assert.equal((await snapshot()).state.muted,true)
  assert.equal((await snapshot()).activeCaptures,0)
  await run('window.voiceTest.failMic(true)')
  await assert.rejects(run('window.voiceTest.muted(false)'),/Microphone unavailable/)
  assert.equal((await snapshot()).state.muted,true)
  await run('window.voiceTest.failMic(false);window.voiceTest.muted(false);window.voiceTest.failDevice(true)')
  await assert.rejects(run("window.voiceTest.configure(true,'missing-device')"),/Could not use that microphone/)
  assert.equal((await snapshot()).inputDeviceId,'default')
  console.log('PASS Disabled voice, reconnects, remote status, permission denial, and failed input-device switching keep coherent state')
  await run('window.voiceTest.noise(true)');assert((await snapshot()).noiseActive)
  await run('window.voiceTest.close()');assert.equal((await snapshot()).noiseActive,false)
  assert.equal((await snapshot()).noiseNodesCreated,(await snapshot()).noiseNodesStopped,'Leaving must stop every worklet')
  await run('window.voiceTest.setup()')
  await run('window.voiceTest.configure(false);window.voiceTest.configure(true);window.voiceTest.hold();window.voiceTest.startUnmute()')
  await new Promise(resolve=>setTimeout(resolve,150))
  await run('window.disabling=window.voiceTest.configure(false);void 0')
  await run('window.voiceTest.release();window.disabling;window.unmute')
  assert.equal((await snapshot()).activeCaptures,0)
  assert.equal((await snapshot()).state.enabled,false)
  await run('window.voiceTest.configure(true);window.voiceTest.hold();window.voiceTest.startUnmute()')
  await new Promise(resolve=>setTimeout(resolve,150))
  await run('window.voiceTest.close();window.voiceTest.release();window.unmute')
  assert.equal((await snapshot()).activeCaptures,0)
  assert.equal((await snapshot()).elements.length,0)
  console.log('PASS Disabling voice and leaving during pending microphone startup stop late capture and detach playback')
  await run('window.voiceTest.setup();window.voiceTest.hold();window.voiceTest.startUnmute();void 0')
  await new Promise(resolve=>setTimeout(resolve,150))
  await run('window.testingStartup=window.voiceTest.testing(true);void 0')
  await run('window.voiceTest.release();window.unmute;window.testingStartup')
  assert.equal((await snapshot()).activeCaptures,0,'Starting local testing during permission acquisition must not publish a late room microphone')
  assert((await snapshot()).state.deafened)
  await run('window.voiceTest.testing(false)')
  assert.equal((await snapshot()).state.muted,false)
  assert.equal((await snapshot()).activeCaptures,1)
  await run('window.voiceTest.close()')
  console.log('PASS Starting microphone testing during pending room capture cancels late publication and restores voice safely afterward')
  const acquisitions=(await snapshot()).captureOptions
  assert(acquisitions.every(options=>options.echoCancellation===true&&options.noiseSuppression===false), 'Every microphone acquisition must retain echo cancellation without native noise suppression: '+JSON.stringify(acquisitions))
  await run("window.voiceTest.setup(true,{bob:0,late:.4})")
  assert.equal((await snapshot()).state.participants.find(person=>person.id==='bob').volume,0,'Saved zero volume must be applied before initial voice playback')
  await run("window.voiceTest.add('late')")
  assert.equal((await snapshot()).state.participants.find(person=>person.id==='late').volume,.4,'Saved volume must also apply to a participant arriving later')
  await run('window.voiceTest.close()')
  console.log('PASS Stored volumes apply before initial playback and to participants who join later')
  clearTimeout(timeout); win.destroy(); app.exit(0)
}).catch(error => { console.error(error); clearTimeout(timeout); win?.destroy(); app.exit(1) })
