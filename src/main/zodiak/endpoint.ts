import { app } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Agent, type Dispatcher } from 'undici'

const PRODUCTION_API = 'https://zodiak.emono.host:20005'
const DEVELOPMENT_API = 'http://127.0.0.1:8080'

export interface Endpoint {
  base: URL
  /** Trusts only the Zodiak certificate authority. Absent for local plain-HTTP development. */
  dispatcher?: Dispatcher
}

let cached: Endpoint | undefined

/**
 * Installed builds always use HTTPS and accept only the pinned Zodiak certificate
 * authority (resources/zodiak-ca.pem). Development can point at a local server.
 */
export function endpoint(): Endpoint {
  if (cached) return cached
  const base = new URL(app.isPackaged ? PRODUCTION_API : process.env.ZODIAK_API_URL || DEVELOPMENT_API)
  if (base.protocol === 'http:') {
    if (app.isPackaged) throw new Error('Installed builds must use HTTPS')
    cached = { base }
    return cached
  }
  if (base.protocol !== 'https:') throw new Error('The Zodiak server address is not valid')
  const caPath = app.isPackaged ? join(process.resourcesPath, 'zodiak-ca.pem') : process.env.ZODIAK_API_CA
  if (!caPath) throw new Error('The Zodiak server certificate is missing')
  let ca: string
  try { ca = readFileSync(caPath, 'utf8') } catch { throw new Error('The Zodiak server certificate is missing') }
  // Passing `ca` replaces the system trust store: no other authority can sign for the server.
  cached = { base, dispatcher: new Agent({ connect: { ca, rejectUnauthorized: true } }) }
  return cached
}
