// Real WebRTC + production session audio in Electron; no server or microphone.
const { app, BrowserWindow } = require('electron')
const { build } = require('esbuild')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const assert = require('node:assert/strict')
const temp = require('node:fs').mkdtempSync(path.join(os.tmpdir(), 'zodiak-audio-test-'))
app.setPath('userData', path.join(temp, 'profile'))
app.setPath('sessionData', path.join(temp, 'session'))
const root = path.resolve(__dirname, '..')
let win
const run = code => win.webContents.executeJavaScript(code, true)
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const timeout = setTimeout(() => { console.error('Audio test timed out'); app.exit(1) }, 60000)
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

// Expose setup/inspection only in this test bundle. All routing and volume
// operations use production session.ts, with real LiveKit RemoteAudioTracks.
const bridge = `
import { RemoteAudioTrack } from 'livekit-client'
export const test = {
  initialize() {
    targets = { video: document.createElement('video'), audioRack: document.body }
    hooks = { onStreams() {}, onParticipants() {}, onTelemetry() {}, onAudioBlocked(value) { window.audioBlocked = value } } as any
    room = { localParticipant: { identity: 'self', getTrackPublication() {} }, remoteParticipants: new Map() } as any
  },
  async add(identity, mediaTrack, receiver) {
    const track = new RemoteAudioTrack(mediaTrack, 'audio-' + identity, receiver)
    track.source = Track.Source.ScreenShareAudio
    const audio = { kind: Track.Kind.Audio, source: Track.Source.ScreenShareAudio, track, setSubscribed() {} }
    const video = { kind: Track.Kind.Video, source: Track.Source.ScreenShare, trackSid: 'video-' + identity, isSubscribed: true, setSubscribed() {} }
    const participant = { identity, name: identity, trackPublications: new Map([['audio', audio], ['video', video]]) }
    room.remoteParticipants.set(identity, participant)
    refreshStreams(room)
    await attachAudio(track, participant as any)
    return 'remote:' + identity + ':video-' + identity
  },
  element(identity) { return remoteAudio.get(identity) },
  graph(identity) { return remoteAudioGraphs.get(identity) },
  context() { return audioContext },
  async refresh() { refreshStreams(room); await resumeRemoteAudio() },
  clear: clearMedia,
}
`

async function setupRenderer() {
  const session = window.audioSession
  session.test.initialize()
  const tx = new AudioContext()
  const monitor = new AudioContext()
  const connections = []
  const probes = new Map()
  async function add(identity, frequency = 440) {
    const oscillator = tx.createOscillator()
    oscillator.frequency.value = frequency
    const level = tx.createGain()
    level.gain.value = 0.025
    const destination = tx.createMediaStreamDestination()
    oscillator.connect(level).connect(destination)
    oscillator.start()
    const sender = new RTCPeerConnection(), receiver = new RTCPeerConnection()
    connections.push(sender, receiver)
    sender.onicecandidate = e => { if (e.candidate) void receiver.addIceCandidate(e.candidate) }
    receiver.onicecandidate = e => { if (e.candidate) void sender.addIceCandidate(e.candidate) }
    const received = new Promise(resolve => { receiver.ontrack = resolve })
    sender.addTrack(destination.stream.getAudioTracks()[0], destination.stream)
    await sender.setLocalDescription(await sender.createOffer())
    await receiver.setRemoteDescription(sender.localDescription)
    await receiver.setLocalDescription(await receiver.createAnswer())
    await sender.setRemoteDescription(receiver.localDescription)
    const event = await received
    const id = await session.test.add(identity, event.track, event.receiver)
    return { id, track: event.track }
  }
  function probe(identity) {
    const stream = session.test.element(identity).srcObject
    let entry = probes.get(identity)
    if (entry?.stream === stream) return entry.analyser
    if (entry) { entry.source.disconnect(); entry.analyser.disconnect(); entry.silent.disconnect() }
    const source = monitor.createMediaStreamSource(stream)
    const analyser = monitor.createAnalyser()
    const silent = monitor.createGain()
    silent.gain.value = 0
    source.connect(analyser).connect(silent).connect(monitor.destination)
    probes.set(identity, { stream, source, analyser, silent })
    return analyser
  }
  async function rms(identity) {
    const analyser = probe(identity)
    await new Promise(resolve => setTimeout(resolve, 180))
    let squares = 0
    const data = new Float32Array(analyser.fftSize)
    for (let i = 0; i < 4; i++) {
      analyser.getFloatTimeDomainData(data)
      squares += data.reduce((sum, value) => sum + value * value, 0) / data.length
      await new Promise(resolve => setTimeout(resolve, 30))
    }
    return Math.sqrt(squares / 4)
  }
  await tx.resume()
  await monitor.resume()
  window.audioProbe = { add, rms, connections, tx, monitor }
  window.first = await add('first')
}

async function main() {
  const source = await fs.readFile(path.join(root, 'src/renderer/src/session.ts'), 'utf8')
  await build({
    stdin: { contents: source + bridge, resolveDir: path.join(root, 'src/renderer/src'), loader: 'ts' },
    bundle: true, format: 'iife', globalName: 'audioSession', outfile: path.join(temp, 'session.js'),
  })
  await fs.writeFile(path.join(temp, 'index.html'), '<!doctype html><body><script src="./session.js"></script></body>')
  await app.whenReady()
  win = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } })
  win.webContents.on('console-message', event => { if (event.level === 'error') console.error(event.message) })
  await win.loadFile(path.join(temp, 'index.html'))
  await run(`(${setupRenderer.toString()})()`)
  await pause(1200)
  const baseline = await run(`audioProbe.rms('first')`)
  assert(baseline > 0.01, `Received audio must reach the processed output; RMS=${baseline}`)
  console.log('PASS Real remote WebRTC audio reaches the production playback output')

  for (const [stream, global, expected] of [[1, 1, 1], [.5, 1, .5], [.01, 1, .01], [1, .01, .01], [.5, .5, .25], [1, 2, 2], [0, 1, 0], [1, 0, 0]]) {
    const amplitude = await run(`audioSession.setStreamVolume(first.id, ${stream}); audioSession.setRemoteAudioVolume(${global}); audioProbe.rms('first')`)
    const ratio = amplitude / baseline
    assert(Math.abs(ratio - expected) < Math.max(0.00001, expected * .12), `Volume ${stream} x ${global}: expected ${expected}, measured ${ratio}`)
    console.log(`PASS Stream ${stream * 100}% x global ${global * 100}%: amplitude ratio ${ratio.toFixed(5)}`)
  }
  await pause(1000)
  assert.equal(win.webContents.isCurrentlyAudible(), false, 'Zero gain must also silence actual playback, with no raw-track bypass')
  console.log('PASS Zero volume silences actual playback')

  await run(`audioSession.setRemoteAudioVolume(1); audioSession.setStreamVolume(first.id, .5); audioSession.setStreamMuted(first.id, true)`)
  await pause(1000)
  assert.equal(win.webContents.isCurrentlyAudible(), false, 'Mute silences actual playback')
  await run(`audioSession.setStreamMuted(first.id, false)`)
  await pause(400)
  assert.equal(win.webContents.isCurrentlyAudible(), true, 'Unmute restores actual playback')
  assert(Math.abs(await run(`audioProbe.rms('first')`) / baseline - .5) < .06, 'Mute preserves the volume level')
  console.log('PASS Mute/unmute controls actual playback and preserves volume')

  await run(`(async () => { window.second = await audioProbe.add('second', 660); audioSession.setStreamVolume(second.id, 1) })()`)
  await pause(500)
  const secondBaseline = await run(`audioProbe.rms('second')`)
  await run(`audioSession.setStreamVolume(first.id, .01)`)
  assert(Math.abs(await run(`audioProbe.rms('second')`) / secondBaseline - 1) < .12, 'One stream slider must not affect another stream')
  await run(`audioSession.setRemoteAudioVolume(.5)`)
  assert(Math.abs(await run(`audioProbe.rms('second')`) / secondBaseline - .5) < .06, 'Global volume affects the second stream')
  console.log('PASS Independent stream levels and shared global volume')

  await run(`(async () => { audioSession.setRemoteAudioVolume(0); window.oldOutput = audioSession.test.element('first').srcObject.getAudioTracks()[0]; window.oldContext = audioSession.test.context(); window.firstReplacement = await audioProbe.add('first', 880) })()`)
  assert.equal(await run(`oldOutput.readyState`), 'ended', 'Replacement stops the old processed output')
  assert.equal(await run(`first.track.readyState`), 'live', 'Cleanup must not stop the received track owned by LiveKit')
  assert.equal(await run(`audioProbe.rms('first')`), 0, 'Replacement preserves zero global volume')
  assert.equal(await run(`audioSession.test.element('first').srcObject.getAudioTracks()[0] === firstReplacement.track`), false, 'Only processed audio is attached to the element')
  console.log('PASS Track replacement cleans up the old graph and preserves zero volume')

  await run(`window.hiddenOutput = audioSession.test.element('first').srcObject.getAudioTracks()[0]; audioSession.hideStream(first.id)`)
  assert.equal(await run(`hiddenOutput.readyState`), 'ended')
  assert.equal(await run(`Boolean(audioSession.test.element('first'))`), false)
  await run(`audioSession.watchStream(first.id); audioSession.test.refresh()`)
  assert.equal(await run(`audioProbe.rms('first')`), 0)
  console.log('PASS Hide/watch tears down and rebuilds audio without losing volume')

  await run(`(async () => { await audioSession.test.context().suspend(); await audioSession.resumeRemoteAudio() })()`)
  assert.equal(await run(`audioSession.test.context().state`), 'running')
  assert.equal(await run(`window.audioBlocked`), false)
  console.log('PASS Enable audio resumes the Web Audio context')

  // The selected device is applied to the element playing the processed stream.
  await run(`audioSession.setRemoteAudioOutputDevice('default')`)
  assert.equal(await run(`audioSession.test.element('first').sinkId`), 'default')
  const failed = await run(`audioSession.setRemoteAudioOutputDevice('missing-audio-test-device').then(() => false, () => true)`)
  assert.equal(failed, true)
  assert.equal(await run(`audioSession.test.element('first').sinkId`), 'default')
  assert.equal(await run(`audioSession.test.element('second').sinkId`), 'default')
  console.log('PASS Output selection and failed-device rollback on processed playback')

  await run(`(async () => { audioSession.test.clear(); audioProbe.connections.forEach(pc => pc.close()); await audioProbe.tx.close(); await audioProbe.monitor.close() })()`)
  assert.equal(await run(`document.querySelectorAll('audio').length`), 0)
  assert.equal(await run(`oldContext.state`), 'closed')
  await pause(1000)
  assert.equal(win.webContents.isCurrentlyAudible(), false)
  console.log('PASS Session cleanup removes playback and closes its context')
  clearTimeout(timeout)
  win.destroy()
  app.exit(0)
}
main().catch(error => { console.error(error); app.exit(1) })
