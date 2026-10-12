const assert = require('node:assert/strict')
const { build } = require('esbuild')
async function main() {
  const bundle = await build({ entryPoints: ['src/renderer/src/system-audio.ts'], bundle: true, platform: 'browser', format: 'cjs', write: false })
  let releaseModule, holdModule = false, releaseStart, holdStart = false, failStart = false, onData, onError
  const contexts = [], tracks = []
  let nativeStarts = 0, nativeStops = 0
  class Context {
    constructor() {
      this.state = 'suspended'; contexts.push(this)
      this.audioWorklet = { addModule: () => holdModule ? new Promise(resolve => { releaseModule = resolve }) : Promise.resolve() }
    }
    createMediaStreamDestination() {
      const track = { readyState: 'live', stop() { this.readyState = 'ended' } }
      tracks.push(track)
      return { stream: { getAudioTracks: () => [track] } }
    }
    close() { this.state = 'closed'; return Promise.resolve() }
    resume() { this.state = 'running'; return Promise.resolve() }
  }
  const window = { sharescreen: {
    onSystemAudio(listener) { onData = listener; return () => { onData = null } },
    onSystemAudioError(listener) { onError = listener; return () => { onError = null } },
    async startSystemAudio() { nativeStarts++; if (holdStart) await new Promise(resolve => { releaseStart = resolve }); return failStart ? { ok: false, error: 'Capture denied' } : { ok: true } },
    async stopSystemAudio() { nativeStops++; return { ok: true } },
  } }
  const module = { exports: {} }
  new Function('module', 'exports', 'window', 'AudioContext', 'AudioWorkletNode', 'URL', 'Blob', bundle.outputFiles[0].text)(module, module.exports, window, Context, class { port = { postMessage() {} }; connect() {}; disconnect() {} }, { createObjectURL: () => 'blob:test', revokeObjectURL() {} }, class {})
  const api = module.exports
  const tick = () => new Promise(resolve => setImmediate(resolve))
  holdModule = true
  let opening = api.openSystemAudioTrack(true)
  await tick()
  await api.closeSystemAudio(); releaseModule()
  await assert.rejects(opening, /cancelled/)
  assert.equal(nativeStarts, 0, 'Cancellation during worklet loading must not start a native capture')
  assert(contexts.every(c => c.state === 'closed'))
  holdModule = false; holdStart = true
  opening = api.openSystemAudioTrack(false)
  await tick(); await api.closeSystemAudio(); releaseStart()
  await assert.rejects(opening, /cancelled/)
  assert.equal(tracks.at(-1).readyState, 'ended')
  assert.equal(onData, null); assert.equal(onError, null)
  holdStart = false; failStart = true
  await assert.rejects(api.openSystemAudioTrack(true), /Capture denied/)
  assert(contexts.every(c => c.state === 'closed'))
  assert.equal(onData, null); assert.equal(onError, null)
  failStart = false
  const errors = []
  const track = await api.openSystemAudioTrack(true, message => { errors.push(message); void api.closeSystemAudio() })
  assert.equal(track.readyState, 'live')
  onError('PipeWire stopped'); await tick()
  assert.deepEqual(errors, ['PipeWire stopped'])
  assert.equal(track.readyState, 'ended')
  assert(contexts.every(c => c.state === 'closed'))
  assert(nativeStops >= 4)
  console.log('PASS Renderer cancels pending worklet/native startup, releases failed captures, and reports runtime failure without leaking tracks or contexts')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
