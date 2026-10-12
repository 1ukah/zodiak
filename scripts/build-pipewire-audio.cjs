const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const output = path.join(root, 'native/pipewire-audio/publish')
function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  if (result.error || result.status !== 0) throw Error(result.error?.message || result.stderr || `${command} failed`)
  return result.stdout.trim()
}
try {
  if (process.platform !== 'linux') throw Error('Build the PipeWire audio helper on Linux')
  const flags = run('pkg-config', ['--cflags', '--libs', 'libpipewire-0.3']).split(/\s+/)
  fs.mkdirSync(output, { recursive: true })
  run(process.env.CC || 'cc', ['-std=gnu11', '-O2', '-Wall', '-Wextra', '-Werror', '-pthread', path.join(root, 'native/pipewire-audio/capture.c'), '-o', path.join(output, 'zodiak-pipewire-audio'), ...flags])
  console.log('Built PipeWire audio helper')
} catch (error) { console.error(`${error.message}\nInstall a C compiler, pkg-config, and PipeWire development headers.`); process.exitCode = 1 }
