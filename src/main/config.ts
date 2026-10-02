import { app } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AppConfig, UpdateChannel } from '../shared/types'
import { isRecord } from './parse'

const DEFAULT_CONFIG: AppConfig = {
  // An absent or malformed saved file must never look like a usable server
  // configuration. The renderer uses its field placeholder for the example.
  url: '',
  apiKey: '',
  apiSecret: '',
  displayName: '',
  showStreamStatistics: false,
  checkForUpdatesOnStartup: true,
  updateChannel: 'stable',
  showChatBubbles: false,
  voiceEnabled: true,
  voiceInputDeviceId: 'default',
  voiceInputVolume: 1,
}

export interface ResolvedServer {
  signalUrl: string
  apiUrl: string
}

function configPath(): string {
  return join(app.getPath('userData'), 'config.json')
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function inputVolume(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1
}

export function requireUpdateChannel(value: unknown): UpdateChannel {
  if (value === undefined || value === 'stable') return 'stable'
  if (value === 'beta') return 'beta'
  throw new Error('Update channel must be Stable or Beta')
}

export function resolveServer(input: string): ResolvedServer {
  const trimmed = input.trim().replace(/\/+$/, '')
  let signalUrl = trimmed
  if (signalUrl.startsWith('https://')) {
    signalUrl = `wss://${signalUrl.slice('https://'.length)}`
  } else if (signalUrl.startsWith('http://')) {
    signalUrl = `ws://${signalUrl.slice('http://'.length)}`
  }
  if (!/^wss?:\/\/[^/\s]+$/.test(signalUrl)) {
    throw new Error('Server URL must look like ws://host:7880')
  }
  const apiUrl = signalUrl.startsWith('wss://')
    ? `https://${signalUrl.slice('wss://'.length)}`
    : `http://${signalUrl.slice('ws://'.length)}`
  return { signalUrl, apiUrl }
}

export function requireDisplayName(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Enter your name')
  const name = value.trim()
  if (!name) throw new Error('Enter your name')
  if (name.length > 40) throw new Error('Name must be 40 characters or less')
  if (/[\u0000-\u001F\u007F]/.test(name)) throw new Error('Name has invalid characters')
  return name
}

export function requireRoom(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Enter a room name')
  const room = value.trim()
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(room)) {
    throw new Error('Room name can use letters, numbers, dashes, and underscores')
  }
  return room
}

function requireCredential(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} is required`)
  const credential = value.trim()
  if (!credential) throw new Error(`${label} is required`)
  if (credential.length > 256) throw new Error(`${label} is too long`)
  return credential
}

export function optionalDisplayName(value: unknown): string {
  if (typeof value !== 'string') return ''
  const name = value.trim()
  if (!name) return ''
  return requireDisplayName(name)
}

export function validateConfig(value: unknown): AppConfig {
  if (!isRecord(value)) throw new Error('Invalid settings')
  const { signalUrl } = resolveServer(stringOr(value.url, ''))
  return {
    url: signalUrl,
    apiKey: requireCredential(value.apiKey, 'API key'),
    apiSecret: requireCredential(value.apiSecret, 'API secret'),
    displayName: optionalDisplayName(value.displayName),
    showStreamStatistics: value.showStreamStatistics === true,
    checkForUpdatesOnStartup: value.checkForUpdatesOnStartup !== false,
    updateChannel: requireUpdateChannel(value.updateChannel),
    showChatBubbles: value.showChatBubbles === true,
    voiceEnabled: value.voiceEnabled !== false,
    voiceInputDeviceId: stringOr(value.voiceInputDeviceId, 'default').slice(0, 512) || 'default',
    voiceInputVolume: inputVolume(value.voiceInputVolume),
  }
}

function normalizeStored(value: unknown): AppConfig {
  const record = isRecord(value) ? value : {}
  const storedUrl = stringOr(record.url, '').trim()
  let url = ''
  if (storedUrl) {
    try {
      url = resolveServer(storedUrl).signalUrl
    } catch {
      // Do not replace an invalid saved URL with a working-looking default.
    }
  }
  return {
    url,
    apiKey: stringOr(record.apiKey, '').trim(),
    apiSecret: stringOr(record.apiSecret, '').trim(),
    displayName: stringOr(record.displayName, '').trim(),
    showStreamStatistics: record.showStreamStatistics === true,
    checkForUpdatesOnStartup: record.checkForUpdatesOnStartup !== false,
    updateChannel: record.updateChannel === 'beta' ? 'beta' : 'stable',
    showChatBubbles: record.showChatBubbles === true,
    voiceEnabled: record.voiceEnabled !== false,
    voiceInputDeviceId: stringOr(record.voiceInputDeviceId, 'default').slice(0, 512) || 'default',
    voiceInputVolume: inputVolume(record.voiceInputVolume),
  }
}

export async function loadConfig(): Promise<AppConfig> {
  try {
    const raw = await readFile(configPath(), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    return normalizeStored(parsed)
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

export async function saveConfig(value: unknown): Promise<AppConfig> {
  const config = validateConfig(value)
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(configPath(), JSON.stringify(config, null, 2), 'utf8')
  return config
}
