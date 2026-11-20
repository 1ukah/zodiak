import { execFile, spawn, type ChildProcess } from 'node:child_process'
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

const startupTimeoutMs = 8_000
// A helper that dies mid-share (a crash, an audio device change) is restarted quietly, a few times per minute at most.
const restartLimit = 3
const restartWindowMs = 60_000

/** Windows uses the WASAPI process-loopback helper; Linux uses the PipeWire helper. */
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

function retire(proc: ChildProcess): void {
  proc.stdout?.removeAllListeners('data')
  if (proc.exitCode !== null || proc.signalCode !== null) return
  proc.kill()
  const timer = setTimeout(() => { if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL') }, 1_000)
  timer.unref()
  proc.once('exit', () => clearTimeout(timer))
}

export function stopSystemAudio(): void {
  const current = capture
  capture = null
  if (!current) return
  current.sender.removeListener('destroyed', current.destroyed)
  current.cancel()
  retire(current.process)
}

export function startSystemAudio(sender: WebContents, excludeDiscord: boolean): Promise<void> {
  if (process.platform !== 'win32' && process.platform !== 'linux') throw new Error('System audio capture is not available on this platform')
  stopSystemAudio()
  const executable = systemAudioHelperPath()
  if (!existsSync(executable)) throw new Error('The system audio helper is missing. Reinstall zodiak.')
  // Both helpers exclude this process tree, so remote voices and streams cannot feed back.
  const args = excludeDiscord ? [String(process.pid), 'discord'] : [String(process.pid)]
  const current: Capture = { process: null as unknown as ChildProcess, sender, destroyed: () => { if (capture === current) stopSystemAudio() }, cancel: () => {} }
  capture = current
  sender.once('destroyed', current.destroyed)
  return new Promise<void>((resolve, reject) => {
    let settled = false
    let ready = false
    const restarts: number[] = []
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      if (error) reject(error)
      else resolve()
    }
    current.cancel = () => finish(new Error('System audio capture cancelled'))
    const launch = (): void => {
      const proc = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
      current.process = proc
      const active = (): boolean => capture === current && current.process === proc
      let launched = false
      let pending = ''
      let lastError = ''
      const failed = (message: string): void => {
        if (!active()) return
        clearTimeout(timer)
        if (ready) {
          const now = Date.now()
          while (restarts.length > 0 && now - restarts[0] > restartWindowMs) restarts.shift()
          if (restarts.length < restartLimit) {
            restarts.push(now)
            retire(proc)
            launch()
            return
          }
          // After startup, failures reach the renderer as events instead of the IPC result.
          if (!sender.isDestroyed()) sender.send(channels.systemAudioError, message)
        }
        finish(new Error(message))
        stopSystemAudio()
      }
      const timer = setTimeout(() => failed('System audio capture timed out'), startupTimeoutMs)
      proc.stdout?.on('data', (chunk: Buffer) => {
        if (active() && !sender.isDestroyed()) sender.send(channels.systemAudioData, chunk)
      })
      proc.stderr?.on('data', (chunk: Buffer) => {
        pending = (pending + chunk.toString()).slice(-16_384)
        const lines = pending.split(/\r?\n/)
        pending = lines.pop() ?? ''
        for (const line of lines) {
          if (line.startsWith('error ')) { lastError = line.slice(6); failed(lastError); break }
          if (!launched && line.startsWith('ready ') && active()) {
            launched = true
            ready = true
            clearTimeout(timer)
            finish()
          }
        }
      })
      proc.once('error', (error) => failed(error.message))
      proc.once('exit', (code, signal) => failed(lastError || `System audio capture stopped (${describeExit(code, signal)})`))
    }
    launch()
  })
}

function describeExit(code: number | null, signal: NodeJS.Signals | null): string {
  if (signal) return signal
  if (code === null) return 'unknown'
  // Windows reports crashes as NTSTATUS codes, e.g. 3221225477 = 0xC0000005.
  return code > 0xffff ? `0x${(code >>> 0).toString(16).toUpperCase()}` : String(code)
}
