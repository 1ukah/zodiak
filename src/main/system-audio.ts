import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app, type WebContents } from 'electron'
import { channels } from '../shared/types'

interface Capture {
  process: ChildProcess
  sender: WebContents
  destroyed: () => void
  cancel: () => void
}
let capture: Capture | null = null

export function systemAudioHelperPath(platform: NodeJS.Platform = process.platform): string {
  const linux = platform === 'linux'
  const directory = linux ? 'pipewire-audio' : 'system-audio-capture'
  const name = linux ? 'zodiak-pipewire-audio' : 'SystemAudioCapture.exe'
  const candidates = [
    join(process.resourcesPath, directory, name),
    join(app.getAppPath(), 'native', directory, 'publish', name),
  ]
  return candidates.find(existsSync) ?? candidates[0]
}

export async function systemAudioAvailable(): Promise<boolean> {
  if (process.platform === 'win32') return true
  if (process.platform !== 'linux' || !existsSync(systemAudioHelperPath())) return false
  // A successful native connection checks the library, socket and permissions.
  // Recheck on demand so restarting PipeWire does not require restarting Zodiak.
  return new Promise((resolve) => {
    execFile(systemAudioHelperPath(), ['--probe'], { timeout: 2_000, maxBuffer: 16_384 }, (error, _stdout, stderr) => {
      resolve(!error && stderr.split(/\r?\n/).includes('ready pipewire'))
    })
  })
}

export function stopSystemAudio(): void {
  const current = capture
  capture = null
  if (!current) return
  current.sender.removeListener('destroyed', current.destroyed)
  current.cancel()
  const proc = current.process
  proc.stdout?.removeAllListeners('data')
  if (proc.exitCode === null && proc.signalCode === null) {
    proc.kill()
    const timer = setTimeout(() => { if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL') }, 1_000)
    timer.unref()
    proc.once('exit', () => clearTimeout(timer))
  }
}

export function startSystemAudio(sender: WebContents, excludeDiscord: boolean): Promise<void> {
  if (process.platform !== 'win32' && process.platform !== 'linux') throw new Error('System audio capture is unavailable on this platform')
  stopSystemAudio()
  const executable = systemAudioHelperPath()
  if (!existsSync(executable)) throw new Error('System audio helper is missing. Rebuild the application with its native audio helper.')
  const args = excludeDiscord ? [String(process.pid), 'discord'] : [String(process.pid)]
  const proc = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  const current: Capture = { process: proc, sender, destroyed: () => { if (capture === current) stopSystemAudio() }, cancel: () => {} }
  capture = current
  sender.once('destroyed', current.destroyed)
  proc.stdout?.on('data', (chunk: Buffer) => {
    if (capture === current && !sender.isDestroyed()) sender.send(channels.systemAudioData, chunk)
  })
  return new Promise<void>((resolve, reject) => {
    let settled = false
    let ready = false
    let pending = ''
    let lastError = ''
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve()
    }
    const failed = (message: string): void => {
      if (capture !== current) return
      if (ready && !sender.isDestroyed()) sender.send(channels.systemAudioError, message)
      finish(new Error(message))
      stopSystemAudio()
    }
    const timer = setTimeout(() => failed('System audio capture timed out'), 8_000)
    current.cancel = () => finish(new Error('System audio capture cancelled'))
    proc.stderr?.on('data', (chunk: Buffer) => {
      pending = (pending + chunk.toString()).slice(-16_384)
      const lines = pending.split(/\r?\n/)
      pending = lines.pop() ?? ''
      for (const line of lines) {
        if (line.startsWith('error ')) { lastError = line.slice(6); failed(lastError); break }
        if (!ready && line.startsWith('ready ') && capture === current) { ready = true; finish() }
      }
    })
    proc.once('error', (error) => failed(error.message))
    proc.once('exit', (code, signal) => failed(lastError || `System audio capture stopped (${signal ?? code ?? 'unknown'})`))
  })
}
