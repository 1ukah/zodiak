import type { ApiResult, HttpMethod } from '../../../shared/zodiak'

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message)
  }
}

/** Calls the API through the main process, which adds the session token. Throws `ApiError` on failure. */
export async function api<T>(method: HttpMethod, path: string, body?: unknown): Promise<T> {
  const result: ApiResult<T> = await window.zodiak.request<T>({ method, path, body })
  if (!result.ok) throw new ApiError(result.error, result.status, result.code)
  return result.value
}

export function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Something went wrong.'
}
