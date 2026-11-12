import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const userData = mkdtempSync(join(tmpdir(), 'zodiak-config-'))
vi.mock('electron', () => ({ app: { getPath: () => userData } }))
const { loadConfig } = await import('./config')

describe('config', () => {
  it('removes the LiveKit secret saved by versions before 2.0 and keeps the settings', async () => {
    const file = join(userData, 'config.json')
    writeFileSync(file, JSON.stringify({ url: 'wss://old.example:7880', apiKey: 'key', apiSecret: 'secret', showChatBubbles: true, voiceInputVolume: 0.4 }))
    const config = await loadConfig()
    expect(config.voiceInputVolume).toBe(0.4)
    const saved = readFileSync(file, 'utf8')
    expect(saved).not.toContain('secret')
    expect(saved).not.toContain('apiKey')
    expect(JSON.parse(saved).voiceInputVolume).toBe(0.4)
  })
})
