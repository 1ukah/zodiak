import { randomUUID } from 'node:crypto'
import { readLocalData, writeLocalData } from './local-data'
import { isRecord } from './parse'

let identity: Promise<string> | undefined

/** Shared by token requests; independent of the display name and room. */
export function getLocalIdentity(): Promise<string> {
  identity ??= loadIdentity().catch(error => { identity = undefined; throw error })
  return identity
}

async function loadIdentity(): Promise<string> {
  const stored = await readLocalData('identity.json')
  if (isRecord(stored) && typeof stored.uuid === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(stored.uuid)) return stored.uuid
  const uuid = randomUUID()
  await writeLocalData('identity.json', { version: 1, uuid })
  return uuid
}
