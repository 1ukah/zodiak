import type { ParticipantPreference, ParticipantPreferenceUpdate } from '../shared/types'
import { resolveServer } from './config'
import { readLocalData, writeLocalData } from './local-data'
import { isRecord } from './parse'

type Preferences = Record<string, Record<string, ParticipantPreference>>
let writes: Promise<unknown> = Promise.resolve()

function serverKey(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid participant preference server')
  return new URL(resolveServer(value).signalUrl).origin
}

function participantId(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 256 || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('Invalid participant identity')
  return value
}

function participantName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 256 || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('Invalid participant name')
  return value.trim()
}

async function readPreferences(): Promise<Preferences> {
  const stored = await readLocalData('participant-volumes.json')
  const servers: Preferences = Object.create(null)
  if (!isRecord(stored) || !isRecord(stored.servers)) return servers
  for (const [url, people] of Object.entries(stored.servers)) {
    if (!isRecord(people)) continue
    let key: string
    try { key = serverKey(url) } catch { continue }
    const preferences = servers[key] ??= Object.create(null)
    for (const [id, person] of Object.entries(people)) {
      if (!isRecord(person)) continue
      try {
        participantId(id)
        const name = participantName(person.name)
        const volume = typeof person.volume === 'number' && Number.isFinite(person.volume) ? Math.max(0, Math.min(1, person.volume)) : 1
        preferences[id] = { name, volume }
      } catch { /* Ignore an invalid entry without losing other participants. */ }
    }
  }
  return servers
}

export async function getParticipantPreferences(value: unknown): Promise<Record<string, ParticipantPreference>> {
  const key = serverKey(value)
  await writes
  return (await readPreferences())[key] ?? Object.create(null)
}

export function saveParticipantPreferences(value: unknown): Promise<void> {
  if (!isRecord(value) || !Array.isArray(value.participants)) throw new Error('Invalid participant preferences')
  const key = serverKey(value.server)
  const updates: ParticipantPreferenceUpdate[] = value.participants.map(person => {
    if (!isRecord(person)) throw new Error('Invalid participant preference')
    const id = participantId(person.id)
    const name = participantName(person.name)
    if (person.volume !== undefined && (typeof person.volume !== 'number' || !Number.isFinite(person.volume))) throw new Error('Invalid participant volume')
    return { id, name, ...(typeof person.volume === 'number' ? { volume: Math.max(0, Math.min(1, person.volume)) } : {}) }
  })
  const result = writes.then(async () => {
    const servers = await readPreferences()
    const people = servers[key] ??= Object.create(null)
    for (const person of updates) people[person.id] = { name: person.name, volume: person.volume ?? people[person.id]?.volume ?? 1 }
    await writeLocalData('participant-volumes.json', { version: 1, servers })
  })
  // Serialize read/modify/write updates and let later saves recover from errors.
  writes = result.catch(() => undefined)
  return result
}

export async function flushParticipantPreferences(): Promise<void> {
  let pending: Promise<unknown>
  do { pending = writes; await pending } while (pending !== writes)
}
