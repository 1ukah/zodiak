import { app } from 'electron'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { loadConfig } from './config'

/**
 * Removes data that older versions saved on the PC and this version does not use:
 * - versions before 2.0 (LiveKit): the LiveKit key and secret in config.json, and the LiveKit identity;
 * - versions before 2.1: volumes per person, which are now account settings on the server.
 * Paths did not change, so nothing has to move.
 */
export async function removeLegacyData(): Promise<void> {
  const userData = app.getPath('userData')
  await Promise.allSettled([
    loadConfig(),
    rm(join(userData, 'identity.json'), { force: true }),
    rm(join(userData, 'participant-volumes.json'), { force: true }),
  ])
}
