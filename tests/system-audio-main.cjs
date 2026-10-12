const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')
const { build } = require('esbuild')
const path = require('node:path')
async function main() {
  const bundle = await build({ entryPoints: ['src/main/system-audio.ts'], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['electron'] })
  function harness(platform) {
    const procs = [], messages = []
    let missing = false, probeError = false
    const sender = new EventEmitter()
    sender.isDestroyed = () => false
    sender.send = (...args) => messages.push(args)
    const module = { exports: {} }
    new Function('require', 'module', 'exports', 'process', bundle.outputFiles[0].text)(id => {
      if (id === 'electron') return { app: { getAppPath: () => '/source' } }
      if (id === 'node:fs') return { existsSync: () => !missing }
      if (id === 'node:child_process') return {
        spawn(executable, args) {
          const p = new EventEmitter()
          Object.assign(p, { executable, args, stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null, signalCode: null, kills: [] })
          p.kill = signal => { p.kills.push(signal || 'SIGTERM'); p.signalCode = signal || 'SIGTERM'; p.emit('exit', null, p.signalCode); return true }
          procs.push(p); return p
        },
        execFile(executable, args, options, callback) {
          assert(executable.endsWith('zodiak-pipewire-audio')); assert.deepEqual(args, ['--probe']); assert(options.timeout)
          callback(probeError ? Error('Unavailable') : null, '', 'ready pipewire\n')
        },
      }
      return require(id)
    }, module, module.exports, { ...process, platform, resourcesPath: '/resources', pid: 123 })
    return { api: module.exports, sender, procs, messages, missing: value => { missing = value }, probeError: value => { probeError = value } }
  }
  const h = harness('linux')
  assert.equal(await h.api.systemAudioAvailable(), true)
  h.probeError(true); assert.equal(await h.api.systemAudioAvailable(), false)
  h.probeError(false)
  h.missing(true); assert.equal(await h.api.systemAudioAvailable(), false)
  assert.throws(() => h.api.startSystemAudio(h.sender, false), /helper is missing/)
  h.missing(false)
  let started = h.api.startSystemAudio(h.sender, true)
  let p = h.procs.at(-1)
  assert.equal(p.executable, path.join('/resources', 'pipewire-audio', 'zodiak-pipewire-audio'))
  assert.deepEqual(p.args, ['123', 'discord'])
  p.stderr.write('rea'); p.stderr.write('dy 48000 2 s16le\n')
  await started
  p.stdout.write(Buffer.from([1, 2, 3, 4]))
  assert.equal(h.messages[0][0], 'audio:data')
  p.exitCode = 1; p.emit('exit', 1, null)
  assert.equal(h.messages.at(-1)[0], 'audio:error')
  assert.equal(h.sender.listenerCount('destroyed'), 0)
  started = h.api.startSystemAudio(h.sender, false)
  const rejection = assert.rejects(started, /cancelled/)
  p = h.procs.at(-1)
  h.api.stopSystemAudio()
  await rejection
  assert.equal(p.kills.length, 1)
  const count = h.messages.length
  p.stdout.write(Buffer.from([1, 2]))
  assert.equal(h.messages.length, count, 'Stopped captures cannot send late PCM')
  started = h.api.startSystemAudio(h.sender, false)
  p = h.procs.at(-1)
  p.stderr.write('error PipeWire is unavailable\n')
  await assert.rejects(started, /PipeWire is unavailable/)
  assert.equal(p.kills.length, 1)
  assert.equal(h.messages.length, count, 'Startup failures return via IPC, without a duplicate runtime error')
  started = h.api.startSystemAudio(h.sender, false)
  p = h.procs.at(-1); p.stderr.write('ready 48000 2 s16le\n'); await started
  h.sender.emit('destroyed')
  assert.equal(p.kills.length, 1)
  assert.equal(h.sender.listenerCount('destroyed'), 0)
  const windows = harness('win32')
  started = windows.api.startSystemAudio(windows.sender, true)
  p = windows.procs.at(-1)
  assert(p.executable.endsWith('SystemAudioCapture.exe'))
  assert.deepEqual(p.args, ['123', 'discord'])
  p.stderr.write('ready 48000 2 s16le\n'); await started
  windows.api.stopSystemAudio()
  console.log('PASS Linux availability, helper selection, split readiness, PCM forwarding, runtime failure, startup failure, cancellation, owner cleanup, Windows dispatch')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
