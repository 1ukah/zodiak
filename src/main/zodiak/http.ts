import { fetch } from 'undici'
import type { ApiResult, HttpMethod } from '../../shared/zodiak'
import { endpoint } from './endpoint'

const TIMEOUT_MS = 15_000
export const UNREACHABLE = 'Could not reach the Zodiak server.'

export async function call<T>(method: HttpMethod, path: string, body: unknown, token: string | null): Promise<ApiResult<T>> {
  let response
  try {
    const { base, dispatcher } = endpoint()
    const headers: Record<string, string> = { accept: 'application/json' }
    if (token) headers.authorization = `Bearer ${token}`
    if (body !== undefined) headers['content-type'] = 'application/json'
    response = await fetch(new URL(path, base), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      dispatcher,
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (error) {
    console.warn('Zodiak request failed:', error)
    return { ok: false, status: 0, error: UNREACHABLE }
  }
  const text = await response.text().catch(() => '')
  let json: unknown = null
  if (text) {
    try { json = JSON.parse(text) } catch { json = null }
  }
  if (response.ok) return { ok: true, value: json as T }
  const errorBody = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>
  return {
    ok: false,
    status: response.status,
    error: typeof errorBody.message === 'string' ? errorBody.message : `The server answered ${response.status}.`,
    code: typeof errorBody.code === 'string' ? errorBody.code : undefined,
    field: typeof errorBody.field === 'string' ? errorBody.field : undefined,
    retryAfterMs: typeof errorBody.retry_after_ms === 'number' ? errorBody.retry_after_ms : undefined,
  }
}
