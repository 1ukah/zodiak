import { app } from 'electron'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { PARTICIPANT_PREFERENCES_SERVER } from '../shared/types'
import { loadConfig } from './config'
import { keepOnlyParticipantPreferences } from './participant-preferences'

/**
 * Removes data that versions before 2.0 (LiveKit) saved and this version does not use:
 * the LiveKit key and secret in config.json, the LiveKit identity, and volumes saved
 * under LiveKit server URLs. Paths did not change, so nothing has to move.
 */
export async function removeLegacyData(): Promise<void> {
  await Promise.allSettled([
    loadConfig(),
    rm(join(app.getPath('userData'), 'identity.json'), { force: true }),
    keepOnlyParticipantPreferences(PARTICIPANT_PREFERENCES_SERVER),
  ])
}
