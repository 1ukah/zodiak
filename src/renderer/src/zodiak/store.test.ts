import { describe, expect, it } from 'vitest'
import type { GuildSnapshot, Message, User } from '../../../shared/protocol'
import { compareIds, ZodiakStore } from './store'

const alice: User = { id: '1', username: 'alice', display_name: 'Alice' }
const bob: User = { id: '2', username: 'bob', display_name: 'Bob' }

function guild(): GuildSnapshot {
  return {
    guild: { id: '10', name: 'Friends', owner_id: alice.id },
    channels: [
      { id: '12', guild_id: '10', kind: 'voice', name: 'General', position: 1 },
      { id: '11', guild_id: '10', kind: 'text', name: 'general', position: 0 },
    ],
    members: [{ user: alice, joined_at: '2026-01-01T00:00:00Z' }],
  }
}

function message(id: string, author = alice): Message {
  return { id, channel_id: '11', guild_id: '10', author, content: `message ${id}`, created_at: '2026-01-01T00:00:00Z', edited_at: null }
}

function ready(store: ZodiakStore): void {
  store.apply({ t: 'READY', d: { user: alice, guilds: [guild()] } })
}

describe('ZodiakStore', () => {
  it('builds state from READY and sorts channels', () => {
    const store = new ZodiakStore()
    ready(store)
    expect(store.user).toEqual(alice)
    expect(store.guilds[0].channels.map((c) => c.id)).toEqual(['11', '12'])
    expect(store.isOwner('10')).toBe(true)
  })

  it('applies server, channel and member events', () => {
    const store = new ZodiakStore()
    ready(store)
    store.apply({ t: 'CHANNEL_CREATE', d: { id: '13', guild_id: '10', kind: 'text', name: 'clips', position: 2 } })
    store.apply({ t: 'CHANNEL_UPDATE', d: { id: '11', guild_id: '10', kind: 'text', name: 'chat', position: 3 } })
    expect(store.guilds[0].channels.map((c) => c.name)).toEqual(['General', 'clips', 'chat'])
    store.apply({ t: 'MEMBER_ADD', d: { guild_id: '10', member: { user: bob, joined_at: '2026-01-02T00:00:00Z' } } })
    store.apply({ t: 'MEMBER_ADD', d: { guild_id: '10', member: { user: bob, joined_at: '2026-01-02T00:00:00Z' } } })
    expect(store.guilds[0].members).toHaveLength(2)
    store.apply({ t: 'MEMBER_REMOVE', d: { guild_id: '10', user_id: bob.id } })
    expect(store.guilds[0].members).toHaveLength(1)
    store.apply({ t: 'GUILD_UPDATE', d: { id: '10', name: 'Renamed', owner_id: alice.id } })
    expect(store.guild('10')?.guild.name).toBe('Renamed')
    store.apply({ t: 'GUILD_DELETE', d: { id: '10' } })
    expect(store.guilds).toEqual([])
  })

  it('keeps message history ordered and without duplicates', () => {
    const store = new ZodiakStore()
    ready(store)
    store.addOlder('11', [message('5'), message('4')], 50)
    expect(store.history('11')?.complete).toBe(true)
    store.apply({ t: 'MESSAGE_CREATE', d: message('6', bob) })
    store.upsertMessage(message('6', bob))
    expect(store.history('11')?.messages.map((m) => m.id)).toEqual(['4', '5', '6'])
    store.apply({ t: 'MESSAGE_UPDATE', d: { ...message('5'), content: 'edited' } })
    expect(store.history('11')?.messages[1].content).toBe('edited')
    store.apply({ t: 'MESSAGE_DELETE', d: { id: '4', channel_id: '11', guild_id: '10' } })
    expect(store.history('11')?.messages.map((m) => m.id)).toEqual(['5', '6'])
    store.apply({ t: 'USER_UPDATE', d: { ...bob, display_name: 'Robert' } })
    expect(store.history('11')?.messages[1].author.display_name).toBe('Robert')
  })

  it('ignores messages for channels whose history is not loaded', () => {
    const store = new ZodiakStore()
    ready(store)
    store.apply({ t: 'MESSAGE_CREATE', d: message('7') })
    expect(store.history('11')).toBeUndefined()
  })

  it('compares 64-bit IDs as numbers', () => {
    expect(compareIds('9', '10')).toBeLessThan(0)
    expect(compareIds('114235411647168512', '114235411647168513')).toBeLessThan(0)
  })
})
