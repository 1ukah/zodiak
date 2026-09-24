import { copyFileSync, mkdirSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outputRoot = join(root, 'native', 'bin', 'macos')
const buildRoot = join(outputRoot, 'build')
const appContents = join(outputRoot, 'SystemAudioCapture.app', 'Contents')
const source = join(root, 'native', 'macos', 'SystemAudioCapture.swift')
const info = join(root, 'native', 'macos', 'SystemAudioCapture-Info.plist')
const sdks = process.env.WELFARE_MACOS_SDK ? [process.env.WELFARE_MACOS_SDK] : ['macosx', 'macosx15.4']

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}`)
}

function compile(architecture, binary) {
  let lastResult
  for (const sdk of sdks) {
    const result = spawnSync('xcrun', [
      '--sdk',
      sdk,
      'swiftc',
      '-O',
      '-module-cache-path',
      join(buildRoot, 'module-cache'),
      '-target',
      `${architecture}-apple-macosx14.2`,
      '-framework',
      'CoreAudio',
      '-framework',
      'Foundation',
      source,
      '-o',
      binary,
    ], { cwd: root, encoding: 'utf8' })
    if (result.error) throw result.error
    if (result.status === 0) {
      if (result.stdout) process.stdout.write(result.stdout)
      if (result.stderr) process.stderr.write(result.stderr)
      return
    }
    lastResult = result
    if (!/SDK is not supported by the compiler/i.test(`${result.stdout}\n${result.stderr}`)) break
  }
  if (lastResult?.stdout) process.stdout.write(lastResult.stdout)
  if (lastResult?.stderr) process.stderr.write(lastResult.stderr)
  throw new Error(`Swift compilation failed with status ${lastResult?.status ?? 'unknown'}`)
}

if (process.platform !== 'darwin') throw new Error('The macOS audio helper must be built on macOS')
rmSync(buildRoot, { recursive: true, force: true })
mkdirSync(buildRoot, { recursive: true })
mkdirSync(join(appContents, 'MacOS'), { recursive: true })

const binary = join(buildRoot, 'SystemAudioCapture-arm64')
compile('arm64', binary)
copyFileSync(binary, join(appContents, 'MacOS', 'SystemAudioCapture'))
copyFileSync(info, join(appContents, 'Info.plist'))
