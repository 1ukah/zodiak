import type { GatewayEvent, LoginRequest, RegisterRequest, User } from './protocol'

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'

export interface ApiRequest {
  method: HttpMethod
  /** A `/v1/...` path, with an optional query string. */
  path: string
  body?: unknown
}

export type ApiResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; error: string; code?: string; field?: string; retryAfterMs?: number }

export type SessionState =
  | { state: 'signed-in'; user: User }
  | { state: 'signed-out' }
  | { state: 'offline'; error: string }

export type GatewayState = 'offline' | 'connecting' | 'ready'

export const zodiakChannels = {
  session: 'zodiak:session',
  login: 'zodiak:login',
  register: 'zodiak:register',
  logout: 'zodiak:logout',
  request: 'zodiak:request',
  event: 'zodiak:event',
  gatewayState: 'zodiak:gateway-state',
  signedOut: 'zodiak:signed-out',
} as const

export interface ZodiakBridge {
  session: () => Promise<SessionState>
  login: (request: LoginRequest) => Promise<ApiResult<User>>
  register: (request: RegisterRequest) => Promise<ApiResult<User>>
  logout: (everywhere: boolean) => Promise<void>
  request: <T>(request: ApiRequest) => Promise<ApiResult<T>>
  onEvent: (listener: (event: GatewayEvent) => void) => () => void
  onGatewayState: (listener: (state: GatewayState) => void) => () => void
  /** The server ended the session (logout elsewhere, password change, or expiry). */
  onSignedOut: (listener: () => void) => () => void
}
