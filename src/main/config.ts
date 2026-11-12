import { app } from 'electron'
import { readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AppConfig, UpdateChannel } from '../shared/types'
import { isRecord } from './parse'

const DEFAULT_CONFIG: AppConfig = {
  displayName: '',
  showStreamStatistics: false,
  checkForUpdatesOnStartup: true,
  updateChannel: 'stable',
  hardwareAcceleration: true,
  voiceEnabled: true,
  voiceInputDeviceId: 'default',
  voiceInputVolume: 1,
  voiceNoiseSuppression: true,
  voiceSuppressionStrength: .8,
  voiceEchoCancellation: true,
  voiceAutoGainControl: false,
  voiceNoiseGate: true,
  voiceAutoInputSensitivity: true,
  voiceInputSensitivity: -50,
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

function suppressionStrength(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : .8
}

function inputSensitivity(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(-100, Math.min(0, value)) : -50
}

export function requireUpdateChannel(value: unknown): UpdateChannel {
  if (value === undefined || value === 'stable') return 'stable'
  if (value === 'beta') return 'beta'
  throw new Error('Update channel must be Stable or Beta')
}

export function requireDisplayName(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Enter your name')
  const name = value.trim()
  if (!name) throw new Error('Enter your name')
  if (name.length > 40) throw new Error('Name must be 40 characters or less')
  if (/[\u0000-\u001F\u007F]/.test(name)) throw new Error('Name has invalid characters')
  return name
}

export function optionalDisplayName(value: unknown): string {
  if (typeof value !== 'string') return ''
  const name = value.trim()
  if (!name) return ''
  return requireDisplayName(name)
}

export function validateConfig(value: unknown): AppConfig {
  if (!isRecord(value)) throw new Error('Invalid settings')
  return {
    displayName: optionalDisplayName(value.displayName),
    showStreamStatistics: value.showStreamStatistics === true,
    checkForUpdatesOnStartup: value.checkForUpdatesOnStartup !== false,
    // Beta is paused; every build follows Stable. Restore to re-enable Beta:
    // updateChannel: requireUpdateChannel(value.updateChannel),
    updateChannel: 'stable',
    hardwareAcceleration: value.hardwareAcceleration !== false,
    voiceEnabled: value.voiceEnabled !== false,
    voiceInputDeviceId: stringOr(value.voiceInputDeviceId, 'default').slice(0, 512) || 'default',
    voiceInputVolume: inputVolume(value.voiceInputVolume),
    voiceNoiseSuppression: value.voiceNoiseSuppression !== false,
    voiceSuppressionStrength: suppressionStrength(value.voiceSuppressionStrength),
    voiceEchoCancellation: value.voiceEchoCancellation !== false,
    voiceAutoGainControl: value.voiceAutoGainControl === true,
    voiceNoiseGate: value.voiceNoiseGate !== false,
    voiceAutoInputSensitivity: value.voiceAutoInputSensitivity !== false,
    voiceInputSensitivity: inputSensitivity(value.voiceInputSensitivity),
  }
}

function normalizeStored(value: unknown): AppConfig {
  const record = isRecord(value) ? value : {}
  return {
    displayName: stringOr(record.displayName, '').trim(),
    showStreamStatistics: record.showStreamStatistics === true,
    checkForUpdatesOnStartup: record.checkForUpdatesOnStartup !== false,
    // Beta is paused, so a previously saved Beta choice moves back to Stable.
    // updateChannel: record.updateChannel === 'beta' ? 'beta' : 'stable',
    updateChannel: 'stable',
    hardwareAcceleration: record.hardwareAcceleration !== false,
    voiceEnabled: record.voiceEnabled !== false,
    voiceInputDeviceId: stringOr(record.voiceInputDeviceId, 'default').slice(0, 512) || 'default',
    voiceInputVolume: inputVolume(record.voiceInputVolume),
    voiceNoiseSuppression: record.voiceNoiseSuppression !== false,
    voiceSuppressionStrength: suppressionStrength(record.voiceSuppressionStrength),
    voiceEchoCancellation: record.voiceEchoCancellation !== false,
    voiceAutoGainControl: record.voiceAutoGainControl === true,
    voiceNoiseGate: record.voiceNoiseGate !== false,
    voiceAutoInputSensitivity: record.voiceAutoInputSensitivity !== false,
    voiceInputSensitivity: inputSensitivity(record.voiceInputSensitivity),
  }
}

/**
 * Chromium's GPU mode must be chosen before the app is ready, so this reads the
 * saved preference synchronously. Any read failure keeps the default (enabled).
 */
export function hardwareAccelerationEnabledSync(): boolean {
  try {
    const parsed: unknown = JSON.parse(readFileSync(configPath(), 'utf8'))
    return !isRecord(parsed) || parsed.hardwareAcceleration !== false
  } catch {
    return true
  }
}

export async function loadConfig(): Promise<AppConfig> {
  try {
    const raw = await readFile(configPath(), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    const config = normalizeStored(parsed)
    // Versions before 2.0 saved the LiveKit server URL, API key and secret here as plain text.
    // Rewrite the file without fields this version does not use.
    if (isRecord(parsed) && Object.keys(parsed).some(key => !(key in config))) {
      await writeFile(configPath(), JSON.stringify(config, null, 2), 'utf8').catch(() => undefined)
    }
    return config
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
