import { BrowserWindow, ipcMain } from 'electron'
import type { AuthResponse, User } from '../../shared/protocol'
import { zodiakChannels, type ApiResult, type SessionState } from '../../shared/zodiak'
import { Gateway } from './gateway'
import { call, UNREACHABLE } from './http'
import { MediaSignal } from './media'
import { parseApiRequest } from './request-guard'
import { clearToken, loadToken, saveToken } from './token-store'

/** The session token lives only in the main process. The renderer never receives it. */
let token: string | null = null
let gateway: Gateway | null = null
let restoring: Promise<SessionState> | null = null

function broadcast(channel: string, payload?: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, payload)
  }
}

function startGateway(): void {
  gateway?.stop()
  if (!token) return
  gateway = new Gateway(token, {
    onEvent: (event) => broadcast(zodiakChannels.event, event),
    onState: (state) => broadcast(zodiakChannels.gatewayState, state),
    onInvalidSession: () => void endSession(true),
  })
  gateway.start()
}

async function endSession(notify: boolean): Promise<void> {
  closeMedia()
  gateway?.stop()
  gateway = null
  token = null
  await clearToken().catch((error) => console.warn('Could not delete the saved session:', error))
  if (notify) broadcast(zodiakChannels.signedOut)
}

async function restore(): Promise<SessionState> {
  token ??= await loadToken()
  if (!token) return { state: 'signed-out' }
  const me = await call<User>('GET', '/v1/users/@me', undefined, token)
  if (me.ok) {
    if (!gateway) startGateway()
    return { state: 'signed-in', user: me.value }
  }
  if (me.status === 401) {
    await endSession(false)
    return { state: 'signed-out' }
  }
  return { state: 'offline', error: me.error || UNREACHABLE }
}

function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length > max) throw new Error('Invalid input')
  return value
}

async function authenticate(path: '/v1/auth/login' | '/v1/auth/register', payload: unknown): Promise<ApiResult<User>> {
  const input = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>
  let body: Record<string, string>
  try {
    body = { username: text(input.username, 64), password: text(input.password, 512) }
    if (path === '/v1/auth/register' && input.display_name !== undefined) body.display_name = text(input.display_name, 128)
  } catch (error) {
    return { ok: false, status: 0, error: (error as Error).message }
  }
  const result = await call<AuthResponse>('POST', path, body, null)
  if (!result.ok) return result
  await endSession(false)
  token = result.value.token
  try {
    await saveToken(token)
  } catch (error) {
    console.warn('Could not save the session:', error)
  }
  startGateway()
  return { ok: true, value: result.value.user }
}

async function logout(everywhere: boolean): Promise<void> {
  if (token) await call('POST', everywhere ? '/v1/auth/logout-all' : '/v1/auth/logout', undefined, token)
  await endSession(false)
}

export function registerZodiakIpc(): void {
  registerMediaIpc()
  ipcMain.handle(zodiakChannels.session, () => {
    restoring ??= restore().finally(() => { restoring = null })
    return restoring
  })
  ipcMain.handle(zodiakChannels.login, (_event, payload: unknown) => authenticate('/v1/auth/login', payload))
  ipcMain.handle(zodiakChannels.register, (_event, payload: unknown) => authenticate('/v1/auth/register', payload))
  ipcMain.handle(zodiakChannels.logout, (_event, everywhere: unknown) => logout(everywhere === true))
  ipcMain.handle(zodiakChannels.request, async (_event, payload: unknown): Promise<ApiResult<unknown>> => {
    let request
    try { request = parseApiRequest(payload) } catch (error) {
      return { ok: false, status: 0, error: (error as Error).message }
    }
    if (!token) return { ok: false, status: 401, error: 'Not logged in.' }
    const result = await call(request.method, request.path, request.body, token)
    if (!result.ok && result.status === 401) await endSession(true)
    return result
  })
}

let media: MediaSignal | null = null

function closeMedia(): void {
  media?.close()
  media = null
}

export function stopZodiak(): void {
  closeMedia()
  gateway?.stop()
  gateway = null
}

export function registerMediaIpc(): void {
  ipcMain.handle(zodiakChannels.mediaConnect, async (_event, channelId: unknown): Promise<ApiResult<true>> => {
    closeMedia()
    if (!token) return { ok: false, status: 401, error: 'Not logged in.' }
    if (typeof channelId !== 'string') return { ok: false, status: 0, error: 'Invalid channel' }
    const signal = new MediaSignal({
      onFrame: (frame) => { if (media === signal) broadcast(zodiakChannels.mediaFrame, frame) },
      onClosed: (reason) => {
        if (media !== signal) return
        media = null
        broadcast(zodiakChannels.mediaClosed, reason)
      },
    })
    media = signal
    const result = await signal.connect(channelId, token)
    if (!result.ok && media === signal) closeMedia()
    return result
  })
  ipcMain.on(zodiakChannels.mediaSend, (_event, frame: unknown) => media?.sendFromRenderer(frame))
  ipcMain.handle(zodiakChannels.mediaDisconnect, () => closeMedia())
}
