import { describe, expect, it } from 'vitest'
import { guildInitials, parseInviteCode } from './ui'

describe('invite codes and server initials', () => {
  it('finds the invite code in pasted text', () => {
    expect(parseInviteCode('AbC123xyZ9')).toBe('AbC123xyZ9')
    expect(parseInviteCode('  Join with AbC123xyZ9  ')).toBe('AbC123xyZ9')
    expect(parseInviteCode('short')).toBeNull()
    expect(parseInviteCode('../../etc/passwd')).toBeNull()
  })

  it('makes short server initials', () => {
    expect(guildInitials('Friends')).toBe('FR')
    expect(guildInitials('late night crew')).toBe('LN')
    expect(guildInitials('  ')).toBe('?')
  })
})
