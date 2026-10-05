// Production tokens/session in three Electron clients against a real LiveKit server.
// Set LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET. Only temporary test rooms are used.
const { app, BrowserWindow } = require('./silent-electron.cjs')
const { build } = require('./build-renderer.cjs')
const { RoomServiceClient } = require('livekit-server-sdk')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const root = path.resolve(__dirname,'..')
const temp = require('node:fs').mkdtempSync(path.join(os.tmpdir(),'zodiak-voice-live-'))
app.setPath('userData',path.join(temp,'profile'));app.setPath('sessionData',path.join(temp,'session'))
app.commandLine.appendSwitch('use-fake-device-for-media-stream')
app.commandLine.appendSwitch('use-fake-ui-for-media-stream')
app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required')
const windows=[];const roomName='codex-voice-test-'+Date.now();const otherRoom=roomName+'-other'
app.on('window-all-closed',()=>{})
let client;let finishing=false
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const timeout=setTimeout(()=>{console.error('Live voice test timed out');void finish(1)},90000)
async function finish(code){
  if(finishing)return;finishing=true;clearTimeout(timeout)
  await Promise.allSettled(windows.filter(win=>!win.isDestroyed()).map(win=>win.webContents.executeJavaScript('window.voiceLive.leave()')))
  windows.forEach(win=>{if(!win.isDestroyed())win.destroy()})
  if(client)await Promise.allSettled([client.deleteRoom(roomName),client.deleteRoom(otherRoom)])
  await fs.rm(path.join(temp,'profile','config.json'),{force:true})
  app.exit(code)
}
const bridge=`
export async function publishVoiceTestScreen() {
  const current = requireRoom(); const context = new AudioContext(); await context.resume();
  const oscillator = context.createOscillator(); const gain = context.createGain(); gain.gain.value = .02;
  const destination = context.createMediaStreamDestination(); oscillator.connect(gain).connect(destination);oscillator.start();
  const canvas=document.createElement('canvas');canvas.width=160;canvas.height=90;
  canvas.getContext('2d')!.fillRect(0,0,160,90); const video=canvas.captureStream(5).getVideoTracks()[0];
  await current.localParticipant.publishTrack(video,{source:Track.Source.ScreenShare});
  await current.localParticipant.publishTrack(destination.stream.getAudioTracks()[0],{source:Track.Source.ScreenShareAudio});
}
`
const harness=`
import {joinRoom,leaveRoom,setVoiceMuted,setVoiceDeafened,setVoiceParticipantMuted,configureVoice,watchStream,hideStream,publishVoiceTestScreen} from './session'
import {setLogLevel,LogLevel} from 'livekit-client';setLogLevel(LogLevel.error)
let state;let streams=[];const errors=[];const captures=[];
const acquire=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
navigator.mediaDevices.getUserMedia=async options=>{const stream=await acquire(options);captures.push(...stream.getTracks());return stream};
window.voiceLive={
  async join(url,token){await joinRoom({url,token,subscribe:false,voice:{enabled:true,inputDeviceId:'default'},media:{video:document.createElement('video'),audioRack:document.body},hooks:{
    onVoice(value){state=value},onStreams(value){streams=value},onChatMessage(){},onConnection(){},onViewers(){},onParticipants(){},onTelemetry(){},onAudioBlocked(){},onError(value){errors.push(value)}
  }})},muted:setVoiceMuted,deafened:setVoiceDeafened,localMute:setVoiceParticipantMuted,configure:configureVoice,
  screen:publishVoiceTestScreen,watch:watchStream,hide:hideStream,leave:leaveRoom,
  snapshot(){return {state,streams,errors,capturing:captures.filter(track=>track.readyState==='live').length,
    audio:[...document.querySelectorAll('audio')].map(element=>({muted:element.muted,playing:!element.paused,tracks:element.srcObject?.getAudioTracks().map(track=>track.readyState)}))}}
}
`
app.whenReady().then(async()=>{
  const {LIVEKIT_URL:url,LIVEKIT_API_KEY:apiKey,LIVEKIT_API_SECRET:apiSecret}=process.env
  assert(url&&apiKey&&apiSecret,'Provide the three LIVEKIT_* environment variables')
  await fs.mkdir(app.getPath('userData'),{recursive:true})
  await fs.writeFile(path.join(app.getPath('userData'),'config.json'),JSON.stringify({url,apiKey,apiSecret}))
  await build({entryPoints:[path.join(root,'src/main/tokens.ts')],bundle:true,platform:'node',format:'cjs',external:['electron'],outfile:path.join(temp,'tokens.cjs')})
  const {createTokenIssuer}=require('./isolated-token-issuer.cjs')
  client=new RoomServiceClient(url.replace(/^ws/,'http'),apiKey,apiSecret,{requestTimeout:8})
  await client.createRoom({name:roomName});await client.createRoom({name:otherRoom})
  await build({stdin:{contents:harness,resolveDir:path.join(root,'src/renderer/src'),loader:'ts'},bundle:true,format:'iife',outfile:path.join(temp,'main.js'),plugins:[{name:'voice-test-screen',setup(build){build.onLoad({filter:/[\\/]session\.ts$/},async args=>({contents:await fs.readFile(args.path,'utf8')+bridge,loader:'ts'}))}}]})
  await fs.writeFile(path.join(temp,'index.html'),'<!doctype html><script src="./main.js"></script>')
  const tokens=[]
  for(const [index,name] of ['Alice','Bob','Other room'].entries()){
    const {createParticipantToken}=await createTokenIssuer(path.join(temp,'tokens.cjs'),path.join(temp,'clients',String(index)),{url,apiKey,apiSecret})
    const issued=await createParticipantToken({role:'viewer',displayName:name,room:index===2?otherRoom:roomName});tokens.push(issued)
    const win=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});windows.push(win)
    await win.loadFile(path.join(temp,'index.html'))
    await win.webContents.executeJavaScript(`window.voiceLive.join(${JSON.stringify(issued.url)},${JSON.stringify(issued.token)})`)
  }
  const run=(index,code)=>windows[index].webContents.executeJavaScript(code,true)
  const snapshot=index=>run(index,'window.voiceLive.snapshot()')
  async function until(index,predicate,label){for(let i=0;i<70;i++){const state=await snapshot(index);if(predicate(state))return state;await pause(100)}throw Error(label)}
  assert.equal((await snapshot(0)).capturing,0)
  await run(0,'window.voiceLive.screen()')
  const before=await until(1,state=>state.streams.length===1,'Screen should be advertised')
  await run(1,`window.voiceLive.watch(${JSON.stringify(before.streams[0].id)})`)
  await until(1,state=>state.audio.length===1&&state.audio[0].playing,'Screen audio should play')
  await run(0,'window.voiceLive.muted(false)')
  await until(1,state=>state.audio.length===2&&state.state.participants.some(person=>person.id===tokens[0].identity&&!person.muted),'Microphone should play alongside screen audio')
  assert.equal((await snapshot(2)).audio.length,0)
  console.log('PASS Production microphone grant delivers room voice alongside screen audio, isolated from another room')
  await run(1,`window.voiceLive.localMute(${JSON.stringify(tokens[0].identity)},true)`)
  await until(1,state=>state.audio.filter(audio=>audio.muted).length===1,'Local mute should affect only the microphone')
  assert(!(await snapshot(0)).state.participants.find(person=>person.id===tokens[0].identity).locallyMuted)
  await run(1,`window.voiceLive.localMute(${JSON.stringify(tokens[0].identity)},false)`)
  await run(1,'window.voiceLive.deafened(true)')
  await until(1,state=>state.audio.length===1&&state.audio[0].playing,'Deafen should preserve screen audio')
  await until(0,state=>state.state.participants.some(person=>person.id===tokens[1].identity&&person.deafened&&person.muted),'Deafen should be shared with the room')
  await run(1,'window.voiceLive.deafened(false)')
  await until(1,state=>state.audio.length===2&&state.state.muted,'Undeafen should restore reception and preserve self-mute')
  console.log('PASS Local mute is private; deafen status reaches peers and affects voice without stopping screen audio')
  await run(0,'window.voiceLive.muted(true)')
  await until(1,state=>state.state.participants.find(person=>person.id===tokens[0].identity)?.muted,'Mute should be shared with peers')
  assert.equal((await snapshot(0)).capturing,0)
  await run(0,'window.voiceLive.muted(false)')
  await until(1,state=>!state.state.participants.find(person=>person.id===tokens[0].identity)?.muted,'Unmute should be shared with peers')
  await run(1,`window.voiceLive.hide(${JSON.stringify(before.streams[0].id)})`)
  await until(1,state=>state.audio.length===1,'Hiding screen should keep microphone playback')
  await run(0,'window.voiceLive.deafened(true)')
  await until(1,state=>state.state.participants.find(person=>person.id===tokens[0].identity)?.deafened,'Publisher deafen should be visible')
  assert.equal((await snapshot(0)).capturing,0)
  await run(0,'window.voiceLive.deafened(false)')
  await until(1,state=>!state.state.participants.find(person=>person.id===tokens[0].identity)?.muted,'Undeafen should restore an unmuted microphone')
  await run(0,'window.voiceLive.configure({enabled:false,inputDeviceId:"default"})')
  await until(1,state=>!state.state.participants.find(person=>person.id===tokens[0].identity)?.enabled,'Voice disable should be visible to peers')
  assert.equal((await snapshot(0)).capturing,0)
  await run(0,'window.voiceLive.configure({enabled:true,inputDeviceId:"default"})')
  assert.equal((await snapshot(0)).state.muted,true)
  await run(0,'window.voiceLive.muted(false)')
  assert.equal((await snapshot(0)).capturing,1)
  await run(0,'window.voiceLive.leave()')
  await pause(300)
  assert.equal((await snapshot(0)).capturing,0)
  await until(1,state=>state.audio.length===0,'Leaving should remove remote voice playback')
  for(let i=0;i<windows.length;i++)assert.deepEqual((await snapshot(i)).errors,[])
  console.log('PASS Mute/unmute, publisher deafen, disabled voice, hidden screens, and room leave keep peer state and capture correct')
  await finish(0)
}).catch(error=>{console.error(error);void finish(1)})
