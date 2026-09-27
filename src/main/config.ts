import { app } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AppConfig } from '../shared/types'
import { isRecord } from './parse'

const DEFAULT_CONFIG: AppConfig = {
  url: 'ws://192.168.15.2:7880',
  apiKey: 'devkey',
  apiSecret: 'secret',
  displayName: '',
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
  }
}

function normalizeStored(value: unknown): AppConfig {
  const record = isRecord(value) ? value : {}
  const url = stringOr(record.url, DEFAULT_CONFIG.url).trim() || DEFAULT_CONFIG.url
  let signalUrl = DEFAULT_CONFIG.url
  try {
    signalUrl = resolveServer(url).signalUrl
  } catch {
    signalUrl = DEFAULT_CONFIG.url
  }
  return {
    url: signalUrl,
    apiKey: stringOr(record.apiKey, '').trim() || DEFAULT_CONFIG.apiKey,
    apiSecret: stringOr(record.apiSecret, '').trim() || DEFAULT_CONFIG.apiSecret,
    displayName: stringOr(record.displayName, '').trim(),
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
