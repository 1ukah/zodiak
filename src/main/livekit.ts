import { RoomServiceClient } from 'livekit-server-sdk'
import { loadConfig, resolveServer } from './config'
import { isRecord } from './parse'
import { toErrorMessage } from './result'

export interface LiveKitServer {
  client: RoomServiceClient
  signalUrl: string
  apiKey: string
  apiSecret: string
}

export async function connectServer(): Promise<LiveKitServer> {
  const config = await loadConfig()
  if (!config.apiKey || !config.apiSecret) {
    throw new Error('Add the API key and secret in Server settings')
  }
  const { signalUrl, apiUrl } = resolveServer(config.url)
  return {
    // Abort the HTTP request before the outer user-facing deadline expires.
    client: new RoomServiceClient(apiUrl, config.apiKey, config.apiSecret, { requestTimeout: 7 }),
    signalUrl,
    apiKey: config.apiKey,
    apiSecret: config.apiSecret,
  }
}

export function explainLiveKitError(error: unknown, signalUrl: string): Error {
  if (isMissingRoom(error)) return new Error('That room no longer exists')
  if (isUnauthorized(error)) {
    return new Error('The API key or secret was rejected. Check the server settings.')
  }
  const text = toErrorMessage(error)
  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|fetch failed|network|Could not reach/i.test(text)) {
    return new Error(`Could not reach the LiveKit server at ${signalUrl}.`)
  }
  if (error instanceof Error && !('status' in error) && !('code' in error)) return error
  return new Error(text)
}

export function isMissingRoom(error: unknown): boolean {
  const text = toErrorMessage(error).toLowerCase()
  if (text.includes('not_found') || text.includes('does not exist') || text.includes('not found')) return true
  if (!isRecord(error)) return false
  return error.status === 404 || error.code === 'not_found'
}

function isUnauthorized(error: unknown): boolean {
  const text = toErrorMessage(error).toLowerCase()
  if (text.includes('unauthorized') || text.includes('permission denied') || text.includes('invalid api key')) {
    return true
  }
  if (!isRecord(error)) return false
  return error.status === 401 || error.code === 'unauthenticated' || error.code === 'permission_denied'
}

export function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    work.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(message))
      },
    )
  })
}
