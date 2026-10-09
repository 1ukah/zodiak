// Real LiveKit transport and production screen publication/playback. Canvas
// replaces desktop capture by default. --desktop uses the real KDE picker.
// Set LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET to an isolated test server.
const { app, BrowserWindow, session } = require('./silent-electron.cjs')
const { build } = require('./build-renderer.cjs')
const { RoomServiceClient } = require('livekit-server-sdk')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const root = path.resolve(__dirname, '..')
const temp = require('node:fs').mkdtempSync(path.join(os.tmpdir(), 'zodiak-screen-live-'))
const roomName = 'screen-live-' + path.basename(temp)
const windows = []
const desktop = process.argv.includes('--desktop')
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
app.setPath('userData', path.join(temp, 'profile'))
app.setPath('sessionData', path.join(temp, 'session'))
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
app.on('window-all-closed', () => {})
let client
let finishing = false
const checks = []
function passed(message) { checks.push(message); console.log('PASS ' + message) }
app.on('before-quit', event => {
  if (!finishing) { event.preventDefault(); console.error('Screen test quit before completion'); void finish(1) }
})
const timeout = setTimeout(() => { console.error('Live screen test timed out'); void finish(1) }, desktop ? 180000 : 60000)

async function finish(code) {
  if (finishing) return
  finishing = true
  clearTimeout(timeout)
  await Promise.race([
    Promise.allSettled(windows.filter(win => !win.isDestroyed()).map(win => win.webContents.executeJavaScript('window.screenTest.leave()'))),
    pause(3000),
  ])
  windows.forEach(win => { if (!win.isDestroyed()) win.destroy() })
  if (client) await client.deleteRoom(roomName).catch(() => undefined)
  const output = path.join(root, 'release/ui-review')
  await fs.mkdir(output, { recursive: true })
  await fs.writeFile(path.join(output, desktop ? 'linux-desktop-test.json' : 'linux-live-video-test.json'), JSON.stringify({ exitCode: code, desktopCapture: desktop, checks }, null, 2))
  await fs.rm(temp, { recursive: true, force: true }).catch(() => undefined)
  app.exit(code)
}

const harness = `
import { joinRoom, leaveRoom, publishScreen, unpublishScreen, watchStream, hideStream } from './session'
import { setLogLevel, LogLevel } from 'livekit-client'
setLogLevel(LogLevel.error)
const video = document.createElement('video');
video.autoplay = true; video.playsInline = true;
video.style.width = '640px'; video.style.height = '360px'; document.body.append(video);
let streams = [], connection = 'offline', frames = 0, timer, captured;
const errors = [];
const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
const context = canvas.getContext('2d'); let phase = 0;
const draw = () => {
  context.fillStyle = '#20c060'; context.fillRect(0, 0, 640, 360);
  context.fillStyle = '#e04040'; context.fillRect((phase++ * 12) % 500, 140, 100, 80);
};
${desktop ? "document.body.append(canvas); draw(); timer = setInterval(draw, 66);" : `Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { value: async () => {
  draw(); timer = setInterval(draw, 66); captured = canvas.captureStream(15); return captured;
}});`}
const countFrame = () => video.requestVideoFrameCallback(() => { frames++; countFrame() });
countFrame();
window.screenTest = {
  async join(url, token) {
    await joinRoom({ url, token, subscribe: false, media: { video, audioRack: document.body }, hooks: {
      onStreams(value) { streams = value }, onConnection(value) { connection = value },
      onError(message) { errors.push(message) }, onViewers() {}, onParticipants() {},
      onTelemetry() {}, onAudioBlocked() {},
    }});
  },
  publish: () => publishScreen(false, false, { resolution: '720p', frameRate: 15, priority: 'quality', bitrateMode: 'dynamic', bitrate: 2000000 }),
  async stop() { await unpublishScreen(); clearInterval(timer) },
  watch: watchStream, hide: hideStream,
  async leave() { clearInterval(timer); captured?.getTracks().forEach(track => track.stop()); await leaveRoom() },
  snapshot() {
    let pixel = [];
    if (video.readyState >= 2) {
      const probe = document.createElement('canvas'); probe.width = 16; probe.height = 16;
      const ctx = probe.getContext('2d'); ctx.drawImage(video, 0, 0, 16, 16);
      pixel = Array.from(ctx.getImageData(0, 0, 16, 16).data);
    }
    return { connection, frames, width: video.videoWidth, height: video.videoHeight,
      time: video.currentTime, pixel, attached: !!video.srcObject, errors,
      streams: streams.map(({ id, local, subscribed }) => ({ id, local, subscribed })) };
  },
};
`

async function until(read, predicate, label) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const value = await read()
    if (predicate(value)) return value
    await pause(100)
  }
  throw new Error(label + ': ' + JSON.stringify(await read(), (key, value) => key === 'pixel' ? value.slice(0, 12) : value))
}

app.whenReady().then(async () => {
  const { LIVEKIT_URL: url, LIVEKIT_API_KEY: apiKey, LIVEKIT_API_SECRET: apiSecret } = process.env
  assert(url && apiKey && apiSecret, 'Provide the three LIVEKIT_* environment variables')
  client = new RoomServiceClient(url.replace(/^ws/, 'http'), apiKey, apiSecret, { requestTimeout: 8 })
  await build({ entryPoints: [path.join(root, 'src/main/tokens.ts')], bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: path.join(temp, 'tokens.cjs') })
  await build({ entryPoints: [path.join(root, 'src/main/rooms.ts')], bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: path.join(temp, 'rooms.cjs') })
  await build({ stdin: { contents: harness, resolveDir: path.join(root, 'src/renderer/src'), sourcefile: 'screen-live.ts' }, bundle: true, format: 'iife', outfile: path.join(temp, 'harness.js') })
  await fs.writeFile(path.join(temp, 'index.html'), '<!doctype html><body><script src="./harness.js"></script></body>')
  let capture
  if (desktop) {
    assert.equal(process.platform, 'linux', 'The desktop test targets Linux')
    await build({ entryPoints: [path.join(root, 'src/main/capture.ts')], bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: path.join(temp, 'capture.cjs') })
    capture = require(path.join(temp, 'capture.cjs'))
    capture.registerCaptureHandler()
    session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => callback(permission === 'media' || permission === 'display-capture'))
  }
  const { createTokenIssuer } = require('./isolated-token-issuer.cjs')
  const rooms = await createTokenIssuer(path.join(temp, 'rooms.cjs'), path.join(temp, 'server-profile'), { url, apiKey, apiSecret })
  const created = await rooms.createLiveRoom({ name: roomName, displayName: 'Linux validation' })
  assert.equal(created.name, roomName)
  assert((await rooms.listLiveRooms()).some(room => room.name === roomName))
  passed('Production server configuration, room creation and room listing reach LiveKit')
  for (const [index, name] of ['Publisher', 'Viewer'].entries()) {
    const { createParticipantToken } = await createTokenIssuer(path.join(temp, 'tokens.cjs'), path.join(temp, 'clients', String(index)), { url, apiKey, apiSecret })
    const issued = await createParticipantToken({ role: index ? 'viewer' : 'publisher', displayName: name, room: roomName })
    const win = new BrowserWindow({ width: 680, height: 420, show: desktop, title: index ? 'Zodiak local video receiver' : 'Zodiak local capture test', webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: !desktop } })
    windows.push(win)
    win.webContents.on('console-message', event => { if (event.level === 'error') console.error(event.message) })
    await win.loadFile(path.join(temp, 'index.html'))
    const joined = await win.webContents.executeJavaScript(`window.screenTest.join(${JSON.stringify(issued.url)}, ${JSON.stringify(issued.token)}).then(() => ({ ok: true }), error => ({ error: error.message, stack: error.stack }))`)
    assert.equal(joined.ok, true, JSON.stringify(joined))
  }
  const run = (index, code) => windows[index].webContents.executeJavaScript(code, true)
  const snapshot = index => run(index, 'window.screenTest.snapshot()')
  assert.equal((await snapshot(0)).connection, 'connected')
  assert.equal((await snapshot(1)).connection, 'connected')
  assert.equal((await rooms.listLiveRoomParticipants({ name: roomName })).length, 2)
  passed('Two Linux Electron clients join LiveKit using production tokens and sessions')
  if (desktop) {
    capture.armCapture({ sourceId: 'portal', withAudio: false, blockDiscordAudio: false })
    console.log('Select a screen or window in the KDE dialog. Video goes only to this temporary local test room.')
  }
  await run(0, 'window.screenTest.publish()')
  const offered = await until(() => snapshot(1), value => value.streams.some(stream => !stream.local), 'Remote screen publication missing')
  const remoteId = offered.streams.find(stream => !stream.local).id
  assert.equal(offered.attached, false)
  await run(1, `window.screenTest.watch(${JSON.stringify(remoteId)})`)
  const playing = await until(() => snapshot(1), value => value.frames >= 5 && value.width > 0, 'Video did not decode')
  if (desktop) {
    const colors = playing.pixel.filter((_value, index) => index % 4 !== 3)
    assert(Math.max(...colors) > 20 && Math.max(...colors) - Math.min(...colors) > 10, 'Received desktop video must not be blank')
  } else assert(playing.pixel[1] > 100 && playing.pixel[1] > playing.pixel[0] * 2, 'Received video must contain the green source pixels')
  const advancing = await until(() => snapshot(1), value => value.frames > playing.frames + 5 && value.time > playing.time, 'Video froze')
  assert.deepEqual(advancing.errors, [])
  const participants = await client.listParticipants(roomName)
  const track = participants.find(person => person.name === 'Publisher').tracks.find(track => track.type === 1)
  assert.equal(track.mimeType, 'video/H264')
  passed(`Production video-only screen share arrives through LiveKit as H264; ${advancing.frames} decoded frames, ${advancing.width}x${advancing.height}, nonblank pixels`)
  await run(1, `window.screenTest.hide(${JSON.stringify(remoteId)})`)
  await until(() => snapshot(1), value => !value.attached && value.streams.every(stream => !stream.subscribed), 'Hide did not detach')
  await run(1, `window.screenTest.watch(${JSON.stringify(remoteId)})`)
  await until(() => snapshot(1), value => value.frames > advancing.frames + 3, 'Watch did not resume')
  passed('Hide and watch detach and resume real remote video')
  await run(0, 'window.screenTest.stop()')
  await until(() => snapshot(1), value => value.streams.length === 0 && !value.attached, 'Stop did not remove remote screen')
  passed('Stopping the publisher removes the remote screen and playback')
  await finish(0)
}).catch(error => { console.error(error); void finish(1) })
