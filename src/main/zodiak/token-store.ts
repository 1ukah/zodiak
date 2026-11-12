import { app, safeStorage } from 'electron'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const FILE = 'zodiak-session.bin'

function path(): string {
  return join(app.getPath('userData'), FILE)
}

/** The token is encrypted with the Windows user's key (DPAPI). Plain text never touches the disk. */
export async function loadToken(): Promise<string | null> {
  if (!safeStorage.isEncryptionAvailable()) return null
  try {
    const token = safeStorage.decryptString(await readFile(path()))
    return /^[0-9a-f]{64}$/.test(token) ? token : null
  } catch {
    return null
  }
}

export async function saveToken(token: string): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure storage is not available on this computer')
  const target = path()
  const temporary = `${target}.tmp`
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(temporary, safeStorage.encryptString(token), { mode: 0o600 })
  await rename(temporary, target)
}

export async function clearToken(): Promise<void> {
  await rm(path(), { force: true })
}
