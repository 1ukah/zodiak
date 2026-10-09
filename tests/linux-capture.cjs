const assert = require('node:assert/strict')
const path = require('node:path')
const { build } = require('esbuild')

async function main() {
  const result = await build({ entryPoints: [path.join(__dirname, '../src/main/capture.ts')], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['electron'] })
  function harness(platform, env) {
    let handler
    let provider = async () => []
    const calls = []
    const module = { exports: {} }
    const electron = {
      session: { defaultSession: { setDisplayMediaRequestHandler(fn) { handler = fn } } },
      desktopCapturer: { getSources(options) { calls.push(options); return provider() } },
    }
    new Function('require', 'module', 'exports', 'process', result.outputFiles[0].text)(
      id => id === 'electron' ? electron : require(id), module, module.exports, { ...process, platform, env },
    )
    const api = module.exports
    api.registerCaptureHandler()
    return { api, calls, sources: fn => { provider = fn }, request: (videoRequested = true) => new Promise(resolve => handler({ videoRequested }, resolve)) }
  }
  const request = { sourceId: 'portal', withAudio: false, blockDiscordAudio: false }
  const source = { id: 'window:portal-session:0', name: 'Selected window', thumbnail: { isEmpty: () => true } }
  let h = harness('linux', { XDG_SESSION_TYPE: 'wayland' })
  assert.deepEqual(await h.api.listSources(), [])
  assert.deepEqual(await h.request(), {})
  assert.equal(h.calls.length, 0)
  assert.throws(() => h.api.armCapture({ ...request, withAudio: true }), /System audio/)
  assert.throws(() => h.api.armCapture({ ...request, blockDiscordAudio: true }), /Discord/)
  assert.throws(() => h.api.armCapture({ ...request, sourceId: 'screen:1' }), /desktop picker/)
  h.sources(async () => [source])
  h.api.armCapture(request)
  assert.strictEqual((await h.request()).video, source)
  assert.deepEqual(h.calls[0].types, ['screen', 'window'])
  assert.equal(h.calls.length, 1)
  assert.deepEqual(await h.request(), {})
  console.log('PASS Wayland opens one portal request, preserves its source and rejects unsupported audio')

  h.sources(async () => [])
  h.api.armCapture(request)
  assert.deepEqual(await h.request(), {})
  h.sources(async () => { throw Error('Portal cancelled') })
  h.api.armCapture(request)
  assert.deepEqual(await h.request(), {})
  let resolveSources
  h.sources(() => new Promise(resolve => { resolveSources = resolve }))
  h.api.armCapture(request)
  const cancelled = h.request()
  h.api.cancelCapture()
  resolveSources([source])
  assert.deepEqual(await cancelled, {})
  h.sources(async () => [source])
  h.api.armCapture(request)
  assert.strictEqual((await h.request()).video, source)
  h.api.armCapture(request)
  assert.deepEqual(await h.request(false), {})
  assert.deepEqual(await h.request(), {})
  console.log('PASS Empty, denied, cancelled and late portal requests release state and allow retry')

  h = harness('win32', {})
  const screen = { ...source, id: 'screen:1', name: 'Desktop' }
  h.sources(async () => [screen, { ...screen, id: 'window:1', name: 'zodiak' }])
  assert.equal((await h.api.listSources()).length, 1)
  h.api.armCapture({ ...request, sourceId: 'screen:1', withAudio: true, blockDiscordAudio: true })
  const streams = await h.request()
  assert.strictEqual(streams.video, screen)
  assert.equal(streams.audio, undefined)
  assert.deepEqual(h.calls.at(-1).types, ['screen'])
  assert.throws(() => h.api.armCapture(request), /Choose a screen/)
  console.log('PASS Windows retains source selection and separately published protected audio')

  h = harness('linux', { XDG_SESSION_TYPE: 'x11' })
  h.sources(async () => [screen])
  assert.equal((await h.api.listSources()).length, 1)
  h.api.armCapture({ ...request, sourceId: 'screen:1' })
  assert.strictEqual((await h.request()).video, screen)
  console.log('PASS X11 retains application source selection with video-only capture')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
