import { describe, expect, it } from 'vitest'
import { guildInitials, inviteDetails, parseInviteCode } from './ui'

describe('invite codes and server initials', () => {
  it('finds the invite code in pasted text', () => {
    expect(parseInviteCode('AbC123xyZ9')).toBe('AbC123xyZ9')
    expect(parseInviteCode('  Join with AbC123xyZ9  ')).toBe('AbC123xyZ9')
    expect(parseInviteCode('short')).toBeNull()
    expect(parseInviteCode('../../etc/passwd')).toBeNull()
  })

  it('describes how long and how often an invite works', () => {
    const now = Date.parse('2026-11-19T12:00:00Z')
    const invite = { code: 'AbC123xyZ9', guild_id: '1', creator_id: '2', created_at: '2026-11-19T11:00:00Z', uses: 2 }
    expect(inviteDetails({ ...invite, expires_at: '2026-11-26T12:00:00Z', max_uses: 10 }, now)).toBe('Expires in 7 days, 2 of 10 uses.')
    expect(inviteDetails({ ...invite, expires_at: '2026-11-19T12:30:00Z', max_uses: null }, now)).toBe('Expires in 30 minutes, no use limit.')
    expect(inviteDetails({ ...invite, uses: 0, expires_at: '2026-11-19T13:00:00Z', max_uses: 1 }, now)).toBe('Expires in 1 hour, 0 of 1 use.')
    expect(inviteDetails({ ...invite, expires_at: null, max_uses: null }, now)).toBe('Never expires, no use limit.')
  })

  it('makes short server initials', () => {
    expect(guildInitials('Friends')).toBe('FR')
    expect(guildInitials('late night crew')).toBe('LN')
    expect(guildInitials('  ')).toBe('?')
  })
})
