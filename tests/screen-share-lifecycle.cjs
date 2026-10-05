// Production session/audio cleanup and real LiveKit track-ended/unpublish paths.
// Only capture input, native audio IPC, and server publication are substituted.
const { app, BrowserWindow } = require('./silent-electron.cjs')
const { build } = require('./build-renderer.cjs')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const root = path.resolve(__dirname, '..')
const temp = require('node:fs').mkdtempSync(path.join(os.tmpdir(), 'zodiak-share-lifecycle-'))
app.setPath('userData', path.join(temp, 'profile'))
app.setPath('sessionData', path.join(temp, 'session'))
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
let win
const run = code => win.webContents.executeJavaScript(code.includes('await ') ? `(async () => { ${code} })()` : code, true)
const timeout = setTimeout(() => { console.error('Screen share lifecycle test timed out'); app.exit(1) }, 60000)

const bridge = `
import { LocalAudioTrack, LocalVideoTrack, LocalTrackPublication, ParticipantEvent, TrackEvent, LogLevel, setLogLevel } from 'livekit-client'
import { TrackInfo } from '@livekit/protocol'
setLogLevel(LogLevel.error)
let nativeRunning = false, subscribed = false, sharing = false, audioTrack, videoTrack;
let pendingAudio = false, releaseAudio, rejectStop = false, closeBeforeVideoReturns = false;
let publishedAudio = 0, stopCalls = 0;
const errors = [], contexts = [];
const NativeAudioContext = window.AudioContext;
window.AudioContext = class extends NativeAudioContext {
  createMediaStreamDestination() { contexts.push(this); return super.createMediaStreamDestination() }
};
window.sharescreen = {
  onSystemAudio() { subscribed = true; return () => { subscribed = false } },
  async startSystemAudio() { nativeRunning = true; return { ok: true, value: true } },
  async stopSystemAudio() { nativeRunning = false; stopCalls++; return { ok: true, value: true } },
  async setSharing(active) { sharing = active; if (!active) nativeRunning = false; return { ok: true, value: true } },
};
const quality = { resolution: '720p', frameRate: 30, priority: 'quality', bitrateMode: 'dynamic', bitrate: 1500000 };
window.shareTest = {
  async setup() {
    if (room) await leaveRoom();
    errors.length = 0; pendingAudio = false; rejectStop = false; closeBeforeVideoReturns = false;
    const current = new Room(); room = current;
    hooks = { onConnection() {}, onStreams() {}, onParticipants() {}, onTelemetry() {}, onAudioBlocked() {}, onError(message) { errors.push(message) } };
    current.setupLocalParticipantEvents(); bindRoom(current);
    const local = current.localParticipant;
    const sdkSetScreen = local.setScreenShareEnabled.bind(local);
    const sdkUnpublish = local.unpublishTrack.bind(local);
    local.unpublishTrack = async (track, stop) => {
      if (rejectStop && track.source === Track.Source.ScreenShare) throw Error('Signaling failed');
      return sdkUnpublish(track, stop);
    };
    const register = track => {
      const pub = new LocalTrackPublication(track.kind, new TrackInfo({sid: crypto.randomUUID(), name: track.source}), track);
      pub.source = track.source;
      local.trackPublications.set(pub.trackSid, pub);
      (track.kind === Track.Kind.Video ? local.videoTrackPublications : local.audioTrackPublications).set(pub.trackSid, pub);
      track.on(TrackEvent.Ended, local.handleTrackEnded);
      local.emit(ParticipantEvent.LocalTrackPublished, pub);
      return pub;
    };
    local.setScreenShareEnabled = async (enabled, ...args) => {
      if (!enabled) return sdkSetScreen(false, ...args);
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 16;
      canvas.getContext('2d').fillRect(0, 0, 16, 16);
      videoTrack = new LocalVideoTrack(canvas.captureStream(30).getVideoTracks()[0]);
      videoTrack.source = Track.Source.ScreenShare;
      const pub = register(videoTrack);
      await Promise.resolve();
      if (closeBeforeVideoReturns) this.endWindow();
      return pub;
    };
    local.publishTrack = async (media, options) => {
      audioTrack = media;
      if (pendingAudio) await new Promise(resolve => { releaseAudio = resolve });
      const track = new LocalAudioTrack(media); track.source = options.source;
      publishedAudio++;
      return register(track);
    };
  },
  async publish(withAudio = true) { await publishScreen(withAudio, false, quality); sharing = true },
  // A source closing ends its raw video track. LiveKit handles the ended event
  // and removes that publication via its production LocalParticipant code.
  endWindow() { const media = videoTrack.mediaStreamTrack; media.stop(); media.dispatchEvent(new Event('ended')) },
  startPending() { pendingAudio = true; window.pendingShare = this.publish().then(() => 'started', error => error.message) },
  release() { pendingAudio = false; releaseAudio?.() },
  closeDuringVideoPublish() { closeBeforeVideoReturns = true },
  async settle() { await new Promise(resolve => setTimeout(resolve, 50)) },
  failStop() { rejectStop = true },
  stop: unpublishScreen,
  leave: leaveRoom,
  disconnect() { room.emit(RoomEvent.Disconnected, DisconnectReason.CLIENT_INITIATED) },
  snapshot() { return {
    nativeRunning, subscribed, sharing, audioState: audioTrack?.readyState,
    video: Boolean(room?.localParticipant.getTrackPublication(Track.Source.ScreenShare)),
    audio: Boolean(room?.localParticipant.getTrackPublication(Track.Source.ScreenShareAudio)),
    openContexts: contexts.filter(context => context.state !== 'closed').length,
    localStreams: [...streams.values()].filter(stream => stream.local).length,
    bitrate: localScreenTargetBitrate, publishedAudio, stopCalls, errors,
  } },
};
`

function assertStopped(state) {
  assert.equal(state.nativeRunning, false, 'Native system-audio capture must stop')
  assert.equal(state.subscribed, false, 'PCM listener must detach')
  assert.equal(state.audioState, 'ended', 'The outgoing audio MediaStreamTrack must stop')
  assert.equal(state.audio, false, 'The screen-audio publication must be removed')
  assert.equal(state.openContexts, 0, 'The capture AudioContext must close')
}

app.whenReady().then(async () => {
  const source = await fs.readFile(path.join(root, 'src/renderer/src/session.ts'), 'utf8')
  await build({ stdin: { contents: source + bridge, resolveDir: path.join(root, 'src/renderer/src'), loader: 'ts' }, bundle: true, format: 'iife', outfile: path.join(temp, 'main.js') })
  await fs.writeFile(path.join(temp, 'index.html'), '<!doctype html><script src="./main.js"></script>')
  win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true } })
  await win.loadFile(path.join(temp, 'index.html'))
  const snapshot = () => run('window.shareTest.snapshot()')

  await run('await window.shareTest.setup(); await window.shareTest.publish()')
  let state = await snapshot()
  assert(state.video && state.audio && state.nativeRunning && state.subscribed)
  assert.equal(state.audioState, 'live')
  await run('window.shareTest.endWindow(); window.shareTest.settle()')
  state = await snapshot(); assertStopped(state)
  assert.equal(state.video, false)
  assert.equal(state.localStreams, 0)
  assert.equal(state.sharing, false)
  assert.equal(state.bitrate, undefined)
  assert.deepEqual(state.errors, [])
  console.log('PASS Closing a window removes video and screen audio, stops native capture, and releases the audio graph')

  await run('await window.shareTest.publish(); await window.shareTest.stop(); await window.shareTest.settle()')
  assertStopped(await snapshot())
  console.log('PASS A new share after automatic shutdown starts normally; manual stop cleans up both tracks')

  await run('window.shareTest.startPending(); window.shareTest.settle()')
  assert((await snapshot()).video)
  await run('window.shareTest.endWindow(); window.shareTest.settle()')
  assert.equal((await snapshot()).nativeRunning, false)
  await run('window.shareTest.release(); await window.pendingShare; await window.shareTest.settle()')
  assert.match(await run('window.pendingShare'), /closed before sharing started/)
  assertStopped(await snapshot())
  assert.equal((await snapshot()).sharing, false)
  console.log('PASS Closing a window during audio publication removes the late audio publication and rejects startup')

  await run('await window.shareTest.setup(); window.shareTest.closeDuringVideoPublish()')
  await assert.rejects(run('window.shareTest.publish()'), /Screen share did not start/)
  assert.equal((await snapshot()).nativeRunning, false)
  assert.equal((await snapshot()).audio, false)
  assert.equal((await snapshot()).openContexts, 0)
  console.log('PASS A window closing during video publication cannot leave native audio running')

  await run('await window.shareTest.setup(); await window.shareTest.publish(); window.shareTest.failStop()')
  await assert.rejects(run('window.shareTest.stop()'), /Signaling failed/)
  assertStopped(await snapshot())
  console.log('PASS Failed video signaling still stops capture and removes the independent audio publication')

  await run('await window.shareTest.setup(); await window.shareTest.publish(false); window.shareTest.endWindow(); await window.shareTest.settle()')
  assert.equal((await snapshot()).video, false)
  assert.equal((await snapshot()).nativeRunning, false)
  console.log('PASS Window shares without audio also shut down cleanly')

  await run('await window.shareTest.setup(); await window.shareTest.publish(); await window.shareTest.leave(); await window.shareTest.settle()')
  assertStopped(await snapshot())
  await run('await window.shareTest.setup(); await window.shareTest.publish(); window.shareTest.disconnect(); await window.shareTest.settle()')
  state = await snapshot()
  assert.equal(state.nativeRunning, false)
  assert.equal(state.audioState, 'ended')
  assert.equal(state.subscribed, false)
  assert.equal(state.openContexts, 0)
  console.log('PASS Leaving or disconnecting also releases the protected system-audio capture')
  clearTimeout(timeout); win.destroy(); app.exit(0)
}).catch(error => { console.error(error); clearTimeout(timeout); win?.destroy(); app.exit(1) })
