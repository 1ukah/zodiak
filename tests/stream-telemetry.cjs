// Validate production telemetry against full browser reports, including fields
// omitted by LiveKit's convenience wrappers and a subscription still pending.
const { app, BrowserWindow } = require('electron')
const { build } = require('esbuild')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const root = path.resolve(__dirname, '..')
const directory = require('node:fs').mkdtempSync(path.join(os.tmpdir(), 'zodiak-telemetry-'))
app.setPath('userData', directory)
app.setPath('sessionData', path.join(directory, 'session'))
const timeout = setTimeout(() => app.exit(1), 30000)
async function main() {
  const source = await fs.readFile(path.join(root,'src/renderer/src/session.ts'),'utf8')
  const probe = `
window.telemetryProbe = async () => {
  const sender = new Map([
    ['out', {id:'out',type:'outbound-rtp',kind:'video',bytesSent:1000,framesEncoded:100,framesSent:100,totalEncodeTime:.2,encoderImplementation:'test-hardware',powerEfficientEncoder:true,codecId:'codec',remoteId:'remote',timestamp:1000}],
    ['remote',{id:'remote',type:'remote-inbound-rtp',roundTripTime:.025,jitter:.002}],
    ['codec',{id:'codec',type:'codec',mimeType:'video/H264'}]
  ]);
  const receiver = new Map([
    ['in',{id:'in',type:'inbound-rtp',kind:'video',bytesReceived:1000,framesDecoded:100,totalDecodeTime:.1,jitterBufferDelay:.5,jitterBufferEmittedCount:100,decoderImplementation:'test-decoder',codecId:'codec',timestamp:1000}],
    ['codec',{id:'codec',type:'codec',mimeType:'video/H264'}]
  ]);
  room = {localParticipant:{getTrackPublication:()=>({track:{kind:Track.Kind.Video,sender:{getStats:async()=>sender},mediaStreamTrack:{getSettings:()=>({width:1920,height:1080,frameRate:60})}}})}};
  let value; hooks = {onTelemetry:metrics=>{value=metrics}};
  streams.set('remote',{id:'remote',local:false,track:{receiver:{getStats:async()=>receiver}}});selectedStreamId='remote';
  await collectTelemetry(room); const ready=value;
  streams.set('remote',{id:'remote',local:false});await collectTelemetry(room);
  return {ready,pending:value};
};`
  await build({stdin:{contents:source+probe,resolveDir:path.join(root,'src/renderer/src'),loader:'ts'},bundle:true,format:'iife',outfile:path.join(directory,'main.js')})
  await fs.writeFile(path.join(directory,'index.html'),'<script src="./main.js"></script>')
  await app.whenReady()
  const win = new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false}})
  await win.loadFile(path.join(directory,'index.html'))
  const result = await win.webContents.executeJavaScript('window.telemetryProbe()')
  assert.equal(result.ready.sent.encoder,'test-hardware')
  assert.equal(result.ready.sent.powerEfficientEncoder,true)
  assert.equal(result.ready.sent.encodeTimeMs,2)
  assert.equal(result.ready.sent.roundTripTimeMs,25)
  assert.equal(result.ready.sent.codec,'video/H264')
  assert.equal(result.ready.received.decodeTimeMs,1)
  assert.equal(result.ready.received.jitterBufferDelayMs,5)
  assert.equal(result.ready.received.decoder,'test-decoder')
  assert.equal(result.pending.received,undefined)
  console.log('PASS Full encoder, codec, decode, buffer and remote-network statistics; pending subscriptions remain safe')
  clearTimeout(timeout);app.exit(0)
}
main().catch(error=>{console.error(error);app.exit(1)})
