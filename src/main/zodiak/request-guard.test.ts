import { describe, expect, it } from 'vitest'
import { parseApiRequest } from './request-guard'

describe('parseApiRequest', () => {
  it('accepts normal API requests', () => {
    expect(parseApiRequest({ method: 'GET', path: '/v1/channels/1/messages?limit=50&before=2' }).path).toBe('/v1/channels/1/messages?limit=50&before=2')
    expect(parseApiRequest({ method: 'DELETE', path: '/v1/guilds/1/members/@me' }).method).toBe('DELETE')
    expect(parseApiRequest({ method: 'POST', path: '/v1/auth/password', body: { a: 1 } }).body).toEqual({ a: 1 })
  })

  it('rejects requests that leave the API or change the session', () => {
    const bad = [
      { method: 'GET', path: 'https://evil.example/v1/users/@me' },
      { method: 'GET', path: '//evil.example/v1/users' },
      { method: 'GET', path: '/v1/../admin' },
      { method: 'GET', path: '/v1/users/%2e%2e/x' },
      { method: 'GET', path: '/v2/users/@me' },
      { method: 'TRACE', path: '/v1/users/@me' },
      { method: 'POST', path: '/v1/auth/login' },
      { method: 'POST', path: '/v1/auth/logout-all/' },
      { method: 'GET', path: '/v1/gateway' },
      { method: 'POST', path: '/v1/channels/1/messages', body: { content: 'x'.repeat(20_000) } },
      null,
    ]
    for (const request of bad) expect(() => parseApiRequest(request)).toThrow()
  })
})
