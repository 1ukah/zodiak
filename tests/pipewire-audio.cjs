// Real PCM and graph tests against a private daemon; never record user audio.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { spawn, execFileSync } = require('node:child_process')
const helper = path.resolve(process.env.ZODIAK_PIPEWIRE_HELPER || 'native/pipewire-audio/publish/zodiak-pipewire-audio')
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
let root, env
const children = new Set()
function launch(command, args, options = {}) {
  const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'], ...options })
  children.add(child)
  child.log = ''
  child.stderr.on('data', b => { child.log = (child.log + b).slice(-16000) })
  child.once('error', error => { child.log += error.message })
  child.once('exit', () => children.delete(child))
  return child
}
async function until(fn, label) {
  for (let i = 0; i < 100; i++) { if (await fn()) return; await pause(50) }
  throw Error('Timed out: ' + label)
}
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  await until(() => child.exitCode !== null || child.signalCode !== null, 'child cleanup')
}
function graph() { return JSON.parse(execFileSync('pw-dump', [], { env, encoding: 'utf8' })) }
function props(o) { return o.info?.props || {} }
async function tone(frequency, name, extra = {}, options = {}) {
  const rate = options.rate || 48000, channels = options.channels || 2
  const properties = { 'application.name': name, 'node.name': name, 'adapter.auto-port-config': { mode: 'dsp', monitor: false, position: 'preserve' }, ...extra }
  const child = launch(path.join(root, 'tone'), [String(frequency), String(rate), String(channels), options.center ? '1' : '0', JSON.stringify(properties)])
  await until(() => graph().some(o => o.type.endsWith(':Node') && props(o)['node.name'] === name && o.info['n-output-ports'] >= channels), name + ' node')
  if (options.volume !== undefined) {
    const node = graph().find(o => o.type.endsWith(':Node') && props(o)['node.name'] === name)
    execFileSync('pw-cli', ['set-param', String(node.id), 'Props', `{ volume = ${options.volume} }`], { env })
  }
  // Simulate normal local playback, which the helper must leave intact.
  if (channels === 2 && !extra['media.class']) for (const ch of ['FL', 'FR']) execFileSync('pw-link', [`${name}:output_${ch}`, `local-output:playback_${ch}`], { env })
  return child
}
async function capture(discord, owner = 999999) {
  const child = launch(helper, [String(owner), ...(discord ? ['discord'] : [])])
  child.pcm = Buffer.alloc(0)
  child.stdout.on('data', b => { child.pcm = Buffer.concat([child.pcm, b]).subarray(-192000) })
  await until(() => child.log.includes('ready 48000'), 'capture ready: ' + child.log)
  return child
}
function amplitude(pcm, frequency, channel = 0) {
  const count = Math.min(12000, Math.floor(pcm.length / 4))
  let real = 0, imaginary = 0
  for (let i = 0; i < count; i++) {
    const sample = pcm.readInt16LE(pcm.length - count * 4 + i * 4 + channel * 2)
    real += sample * Math.cos(2 * Math.PI * frequency * i / 48000)
    imaginary += sample * Math.sin(2 * Math.PI * frequency * i / 48000)
  }
  return 2 * Math.hypot(real, imaginary) / count
}
function present(cap, frequency, expected = 3000) {
  for (const ch of [0, 1]) {
    const value = amplitude(cap.pcm, frequency, ch)
    assert(Math.abs(value - expected) < expected * .15, `${frequency} Hz channel ${ch}: ${value}, expected ${expected}`)
  }
}
function absent(cap, frequency) { assert(amplitude(cap.pcm, frequency) < 60, `${frequency} Hz leaked into capture`) }
function playbackLinks(g) { return g.filter(o => o.type.endsWith(':Link') && props(g.find(n => n.id === props(o)['link.input.node']) || {})['node.name'] === 'local-output').map(o => [props(o)['link.output.port'], props(o)['link.input.port']].join(':')).sort() }
async function main() {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'zodiak-pipewire-'))
  env = { ...process.env, PIPEWIRE_RUNTIME_DIR: root, PIPEWIRE_REMOTE: 'zodiak-test' }
  const flags = execFileSync('pkg-config', ['--cflags', '--libs', 'libpipewire-0.3'], { env, encoding: 'utf8' }).trim().split(/\s+/)
  execFileSync(process.env.CC || 'cc', ['-std=gnu11', '-O2', '-Wall', '-Wextra', '-Werror', '-pthread', path.join(__dirname, 'pipewire-tone.c'), '-o', path.join(root, 'tone'), ...flags, '-lm'], { env })
  const config = `context.properties = { core.daemon = true core.name = zodiak-test default.clock.rate = 48000 default.clock.quantum = 480 }
context.spa-libs = { audio.convert.* = audioconvert/libspa-audioconvert support.* = support/libspa-support }
context.modules = [ { name = libpipewire-module-protocol-native } { name = libpipewire-module-client-node } { name = libpipewire-module-adapter } { name = libpipewire-module-link-factory } { name = libpipewire-module-spa-node-factory } { name = libpipewire-module-metadata } { name = libpipewire-module-access } ]
context.objects = [ { factory = spa-node-factory args = { factory.name = support.node.driver node.name = Dummy-Driver priority.driver = 20000 } } { factory = adapter args = { factory.name = support.null-audio-sink node.name = local-output media.class = Audio/Sink audio.position = [ FL FR ] adapter.auto-port-config = { mode = dsp monitor = true position = preserve } } } ]`
  const configPath = path.join(root, 'pipewire.conf')
  await fs.writeFile(configPath, config)
  const daemon = launch('pipewire', ['-c', configPath])
  await until(async () => { try { await fs.access(path.join(root, 'zodiak-test')); return true } catch { return false } }, 'private daemon')
  assert.match(execFileSync(helper, ['--probe'], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) || 'connected', /connected/)
  let cap = await capture(true)
  await pause(400)
  assert(cap.pcm.length > 10000, 'Silence must still produce a live PCM stream')
  absent(cap, 440)
  for (let i = 0; i < 30; i++) {
    const transient = launch(helper, ['--probe'])
    await until(() => transient.exitCode !== null, 'transient client probe')
    assert.equal(transient.exitCode, 0)
  }
  assert.equal(cap.exitCode, null, 'Transient registry clients must not terminate capture')
  const normal = await tone(440, 'game')
  await tone(660, 'music', {}, { volume: .5 })
  let discord = await tone(880, 'WEBRTC-VoiceEngine', { 'application.name': 'WEBRTC VoiceEngine', 'application.process.binary': 'Discord' })
  await tone(1100, 'zodiak')
  await tone(1320, 'microphone', { 'media.class': 'Audio/Source', 'node.always-process': true })
  const before = playbackLinks(graph())
  await pause(1200)
  present(cap, 440); present(cap, 660, 1500); absent(cap, 880); absent(cap, 1100); absent(cap, 1320)
  assert.deepEqual(playbackLinks(graph()), before)
  console.log('PASS Mixed application PCM, per-app volume, Discord exclusion, self exclusion, no microphone, local routing preserved')
  const gameId = graph().find(o => o.type.endsWith(':Node') && props(o)['node.name'] === 'game').id
  execFileSync('pw-cli', ['set-param', String(gameId), 'Props', '{ mute = true }'], { env })
  await pause(1200)
  absent(cap, 440); present(cap, 660, 1500)
  execFileSync('pw-cli', ['set-param', String(gameId), 'Props', '{ mute = false }'], { env })
  await pause(1200)
  present(cap, 440)
  console.log('PASS Per-application mute changes apply to captured playback')
  await stop(cap)
  assert(!graph().some(o => props(o)['node.name'] === 'zodiak.screen-audio'), 'Capture node must be removed')
  cap = await capture(false)
  await pause(1200)
  present(cap, 440); present(cap, 880); absent(cap, 1100)
  console.log('PASS Discord is included when exclusion is disabled; Zodiak is always excluded')
  await stop(cap)
  cap = await capture(true, normal.pid)
  await pause(1200)
  absent(cap, 440); present(cap, 660, 1500)
  console.log('PASS Owner process identity is excluded independently of application name')
  await stop(cap)
  cap = await capture(true, process.pid)
  await pause(1200)
  absent(cap, 440); absent(cap, 660)
  await stop(cap)
  console.log('PASS Owner child processes are excluded')
  cap = await capture(true)
  await stop(discord)
  discord = await tone(880, 'discord-flatpak', { 'application.id': 'com.discordapp.DiscordCanary' })
  await tone(1540, 'mono', {}, { rate: 44100, channels: 1 })
  await tone(1760, 'surround', {}, { channels: 6, center: true })
  await pause(1200)
  absent(cap, 880); present(cap, 1540); present(cap, 1760, 3000 / Math.sqrt(2))
  await stop(normal)
  await pause(1200)
  absent(cap, 440); present(cap, 660, 1500)
  await tone(440, 'game-restarted')
  await pause(1200)
  present(cap, 440); absent(cap, 880)
  console.log('PASS Stream churn, Flatpak Discord identity, 44.1 kHz mono conversion, surround center downmix')
  await stop(cap)
  // Restarting a helper cannot leave duplicate capture links behind.
  cap = await capture(true)
  await stop(daemon)
  await until(() => cap.exitCode !== null, 'daemon loss')
  assert.notEqual(cap.exitCode, 0)
  assert.match(cap.log, /error /)
  console.log('PASS Stop removes graph objects; daemon loss exits with an actionable error')
  const unavailable = spawn(helper, ['--probe'], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  await new Promise(resolve => unavailable.once('exit', resolve))
  assert.notEqual(unavailable.exitCode, 0)
}
main().catch(error => { console.error(error); process.exitCode = 1 }).finally(async () => {
  await Promise.all([...children].map(stop))
  if (root) await fs.rm(root, { recursive: true, force: true })
})
