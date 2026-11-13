import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const userData = mkdtempSync(join(tmpdir(), 'zodiak-legacy-'))
vi.mock('electron', () => ({ app: { getPath: () => userData } }))
const { removeLegacyData } = await import('./legacy-data')

const file = (name: string) => join(userData, name)

describe('data from older versions', () => {
  it('is removed, and the PC settings stay', async () => {
    writeFileSync(file('config.json'), JSON.stringify({ url: 'wss://old.example:7880', apiKey: 'key', apiSecret: 'secret', showChatBubbles: true, voiceInputVolume: 0.4 }))
    writeFileSync(file('identity.json'), JSON.stringify({ version: 1, uuid: '6f1d2c3b-1a2b-4c3d-8e4f-123456789abc' }))
    writeFileSync(file('participant-volumes.json'), JSON.stringify({ version: 1, servers: {
      'wss://old.example:7880': { 'livekit-uuid': { name: 'Old', volume: 0.5 } },
      'wss://zodiak': { '42': { name: 'Friend', volume: 1.5 } },
    } }))

    await removeLegacyData()

    const config = readFileSync(file('config.json'), 'utf8')
    expect(config).not.toContain('secret')
    expect(config).not.toContain('apiKey')
    expect(JSON.parse(config).voiceInputVolume).toBe(0.4)
    expect(existsSync(file('identity.json'))).toBe(false)
    expect(existsSync(file('participant-volumes.json'))).toBe(false)
  })
})
