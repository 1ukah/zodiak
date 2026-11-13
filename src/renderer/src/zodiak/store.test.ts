import { describe, expect, it } from 'vitest'
import type { GuildSnapshot, Message, User, UserSettings } from '../../../shared/protocol'
import { compareIds, ZodiakStore } from './store'

const alice: User = { id: '1', username: 'alice', display_name: 'Alice' }
const bob: User = { id: '2', username: 'bob', display_name: 'Bob' }
const noSettings: UserSettings = { members_hidden: false, people: [] }

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
  store.apply({ t: 'READY', d: { user: alice, guilds: [guild()], voice_states: [], online: [], settings: noSettings } })
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

  it('tracks who is in each voice channel', () => {
    const store = new ZodiakStore()
    store.apply({ t: 'READY', d: { user: alice, guilds: [guild()], voice_states: [
      { guild_id: '10', channel_id: '12', participants: [{ user_id: alice.id, muted: false, deafened: false, streaming: false }] },
    ], online: [], settings: noSettings } })
    expect(store.voice.get('12')?.participants).toHaveLength(1)
    store.apply({ t: 'VOICE_STATE_UPDATE', d: { guild_id: '10', channel_id: '12', participants: [] } })
    expect(store.voice.has('12')).toBe(false)
    expect(store.memberName('10', alice.id)).toBe('Alice')
  })

  it('keeps the account settings from READY and local changes', () => {
    const store = new ZodiakStore()
    const settings: UserSettings = { members_hidden: true, people: [{ user_id: bob.id, voice_volume: 0.5, voice_muted: false, stream_volume: 1.5, stream_muted: true }] }
    store.apply({ t: 'READY', d: { user: alice, guilds: [guild()], voice_states: [], online: [], settings } })
    expect(store.membersHidden).toBe(true)
    expect(store.person(bob.id).stream_volume).toBe(1.5)
    expect(store.person('99')).toEqual({ user_id: '99', voice_volume: 1, voice_muted: false, stream_volume: 1, stream_muted: false })
    store.updatePerson(bob.id, { voice_muted: true, stream_volume: undefined })
    expect(store.person(bob.id)).toEqual({ user_id: bob.id, voice_volume: 0.5, voice_muted: true, stream_volume: 1.5, stream_muted: true })
    store.reset()
    expect(store.savedPeople()).toEqual([])
  })

  it('tracks who is online', () => {
    const store = new ZodiakStore()
    store.apply({ t: 'READY', d: { user: alice, guilds: [guild()], voice_states: [], online: [alice.id], settings: noSettings } })
    expect(store.isOnline(bob.id)).toBe(false)
    store.apply({ t: 'PRESENCE_UPDATE', d: { user_id: bob.id, online: true } })
    expect(store.isOnline(bob.id)).toBe(true)
    store.apply({ t: 'PRESENCE_UPDATE', d: { user_id: bob.id, online: false } })
    expect(store.isOnline(bob.id)).toBe(false)
    expect(store.isOnline(alice.id)).toBe(true)
  })

  it('compares 64-bit IDs as numbers', () => {
    expect(compareIds('9', '10')).toBeLessThan(0)
    expect(compareIds('114235411647168512', '114235411647168513')).toBeLessThan(0)
  })
})
