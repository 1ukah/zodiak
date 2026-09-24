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
  proc.stdout?.removeAllListeners()
  proc.stderr?.removeAllListeners()
  proc.removeAllListeners()
  if (!proc.killed) proc.kill()
}

export function startSystemAudio(sender: WebContents): Promise<void> {
  if (process.platform !== 'win32') throw new Error('System audio capture requires Windows')
  stopSystemAudio()
  const executable = executablePath()
  if (!existsSync(executable)) throw new Error('System audio capture is missing')
  const proc = spawn(executable, [], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  capture = proc
  owner = sender
  const stdout = proc.stdout
  const stderr = proc.stderr
  if (!stdout || !stderr) {
    stopSystemAudio()
    throw new Error('System audio capture failed')
  }
  stdout.on('data', (chunk: Buffer) => {
    if (capture !== proc || !owner || owner.isDestroyed()) return
    owner.send(channels.systemAudioData, chunk)
  })
  sender.once('destroyed', () => {
    if (owner === sender) stopSystemAudio()
  })
  return waitUntilReady(proc, stderr).catch((error: unknown) => {
    if (capture === proc) stopSystemAudio()
    throw error instanceof Error ? error : new Error('System audio capture failed')
  })
}

function executablePath(): string {
  const candidates = [
    join(process.resourcesPath, 'SystemAudioCapture.exe'),
    join(app.getAppPath(), 'native', 'bin', 'SystemAudioCapture.exe'),
    join(process.cwd(), 'native', 'bin', 'SystemAudioCapture.exe'),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return candidates[0] ?? ''
}

function waitUntilReady(proc: ChildProcess, stderr: NodeJS.ReadableStream): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    let text = ''
    let pending = ''
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      if (error) reject(error)
      else resolve()
    }
    timer = setTimeout(() => {
      finish(new Error('System audio capture timed out'))
    }, 8000)
    stderr.on('data', (chunk: Buffer) => {
      const piece = chunk.toString('utf8')
      text += piece
      pending += piece
      const lines = pending.split(/\r?\n/)
      pending = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed.startsWith('note ') || trimmed.startsWith('ready ')) console.info(trimmed)
        if (trimmed.startsWith('ready ')) finish()
      }
    })
    proc.on('error', (error) => {
      finish(error)
    })
    proc.on('exit', (code) => {
      if (capture === proc) {
        capture = null
        owner = null
      }
      const detail = text
        .split(/\r?\n/)
        .map((entry) => entry.trim())
        .find((entry) => entry.startsWith('error'))
      const message = detail ? detail.replace(/^error\s+/, '') : ''
      finish(new Error(message || `System audio capture exited (${code ?? 'unknown'})`))
    })
  })
}
