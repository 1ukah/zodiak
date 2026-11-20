import { describe, expect, it } from 'vitest'
import type { Member } from '../../../shared/protocol'
import { mentionQuery, mentionSuggestions, mentionsUser, resolveMention } from './mentions'

const member = (id: string, username: string, display_name: string): Member => ({ user: { id, username, display_name }, joined_at: '2026-11-20T00:00:00Z' })
const members = [
  member('1', 'fekz', 'Felipe'),
  member('2', 'yosef', 'Yosef'),
  member('3', 'antonio', 'Tony Stark'),
  member('4', 'didy', 'Yosef'),
]

describe('mentions', () => {
  it('finds people by username first, then by a display name only one person has', () => {
    expect(resolveMention('fekz', members)?.id).toBe('1')
    expect(resolveMention('FEKZ', members)?.id).toBe('1')
    expect(resolveMention('Felipe', members)?.id).toBe('1')
    expect(resolveMention('yosef', members)?.id).toBe('2')
    expect(resolveMention('nobody', members)).toBeUndefined()
  })

  it('knows when a message mentions someone', () => {
    expect(mentionsUser('hey @fekz, look', members, '1')).toBe(true)
    expect(mentionsUser('hey @Felipe.', members, '1')).toBe(true)
    expect(mentionsUser('mail me at a@fekz.com', members, '1')).toBe(false)
    expect(mentionsUser('@yosef', members, '1')).toBe(false)
  })

  it('finds the @ the caret is in', () => {
    expect(mentionQuery('hi @fe', 6)).toEqual({ start: 3, query: 'fe' })
    expect(mentionQuery('@', 1)).toEqual({ start: 0, query: '' })
    expect(mentionQuery('a@fe', 4)).toBeNull()
    expect(mentionQuery('hi @fe there', 12)).toBeNull()
  })

  it('suggests usernames and display names', () => {
    expect(mentionSuggestions('fe', members).map((u) => u.username)).toEqual(['fekz'])
    expect(mentionSuggestions('yo', members).map((u) => u.username).sort()).toEqual(['didy', 'yosef'])
    expect(mentionSuggestions('stark', members).map((u) => u.username)).toEqual(['antonio'])
    expect(mentionSuggestions('', members)).toHaveLength(4)
  })
})
