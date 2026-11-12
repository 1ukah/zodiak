import type { ApiRequest, HttpMethod } from '../../shared/zodiak'

const METHODS: readonly HttpMethod[] = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE']
const PATH = /^\/v1\/[A-Za-z0-9@._~/-]*(\?[A-Za-z0-9_=&-]*)?$/
/** These routes change the local session, so only the dedicated bridge functions may call them. */
const RESERVED = new Set(['/v1/auth/register', '/v1/auth/login', '/v1/auth/logout', '/v1/auth/logout-all', '/v1/gateway'])
const MAX_BODY_BYTES = 16 * 1024

/** Checks a request from the renderer before the main process adds the session token. */
export function parseApiRequest(value: unknown): ApiRequest {
  if (!value || typeof value !== 'object') throw new Error('Invalid request')
  const { method, path, body } = value as Record<string, unknown>
  if (typeof method !== 'string' || !METHODS.includes(method as HttpMethod)) throw new Error('Invalid request method')
  if (typeof path !== 'string' || path.length > 512 || !PATH.test(path)) throw new Error('Invalid request path')
  const route = path.split('?')[0]
  if (route.split('/').some((segment) => segment === '.' || segment === '..')) throw new Error('Invalid request path')
  if (RESERVED.has(route.replace(/\/+$/, ''))) throw new Error('This request is not allowed')
  if (body !== undefined && JSON.stringify(body).length > MAX_BODY_BYTES) throw new Error('The request is too large')
  return { method: method as HttpMethod, path, body }
}
