import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app, type WebContents } from 'electron'
import { channels } from '../shared/types'

let capture: ChildProcess | null = null
let owner: WebContents | null = null

export function stopSystemAudio(): void {
  const proc = capture
  capture = null
  owner = null
  if (!proc) return
  proc.stdout?.removeAllListeners(); proc.stderr?.removeAllListeners(); proc.removeAllListeners()
  if (!proc.killed) proc.kill()
}

export function startSystemAudio(sender: WebContents): Promise<void> {
  if (process.platform !== 'win32') throw new Error('Discord exclusion requires Windows')
  stopSystemAudio()
  const executable = helperPath()
  if (!existsSync(executable)) throw new Error('Discord-exclusion audio helper is missing')
  const proc = spawn(executable, [], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  capture = proc; owner = sender
  const stdout = proc.stdout; const stderr = proc.stderr
  if (!stdout || !stderr) { stopSystemAudio(); throw new Error('Discord-exclusion audio capture failed') }
  stdout.on('data', (chunk: Buffer) => {
    if (capture === proc && owner && !owner.isDestroyed()) owner.send(channels.systemAudioData, chunk)
  })
  sender.once('destroyed', () => { if (owner === sender) stopSystemAudio() })
  return waitReady(proc, stderr).catch((error: unknown) => {
    if (capture === proc) stopSystemAudio()
    throw error instanceof Error ? error : new Error('Discord-exclusion audio capture failed')
  })
}

function helperPath(): string {
  const candidates = [
    join(process.resourcesPath, 'system-audio-capture', 'SystemAudioCapture.exe'),
    join(app.getAppPath(), 'native', 'system-audio-capture', 'publish', 'SystemAudioCapture.exe'),
  ]
  return candidates.find(existsSync) ?? candidates[0]
}

function waitReady(proc: ChildProcess, stderr: NodeJS.ReadableStream): Promise<void> {
  return new Promise((resolve, reject) => {
    let text = ''; let done = false
    const finish = (error?: Error): void => { if (done) return; done = true; clearTimeout(timer); error ? reject(error) : resolve() }
    const timer = setTimeout(() => finish(new Error('Discord-exclusion audio capture timed out')), 8_000)
    stderr.on('data', (chunk: Buffer) => {
      text += chunk.toString()
      if (text.split(/\r?\n/).some((line) => line.startsWith('ready '))) finish()
    })
    proc.once('error', finish)
    proc.once('exit', (code) => finish(new Error(text.match(/error\s+(.+)/)?.[1] ?? `Audio capture exited (${code ?? 'unknown'})`)))
  })
}
