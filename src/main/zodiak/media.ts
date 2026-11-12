import { app } from 'electron'
import { WebSocket } from 'undici'
import type { MediaClientFrame, MediaServerFrame, VoiceJoinResponse } from '../../shared/protocol'
import type { ApiResult } from '../../shared/zodiak'
import { endpoint } from './endpoint'
import { call } from './http'

const PING_INTERVAL_MS = 15_000
const MAX_FRAME_BYTES = 128 * 1024
const CLIENT_OPS = new Set(['publish', 'subscribe_answer', 'state', 'watch'])

export interface MediaHandlers {
  onFrame: (frame: MediaServerFrame) => void
  onClosed: (reason: string) => void
}

/**
 * The media signaling URL comes from the API. Installed builds accept only the API's
 * own host over WSS, so the connection uses the same pinned certificate authority.
 */
export function checkMediaUrl(value: string, api: URL, packaged: boolean): URL {
  let url: URL
  try { url = new URL(value) } catch { throw new Error('The voice server address is not valid') }
  if (url.username || url.password || url.hash) throw new Error('The voice server address is not valid')
  if (packaged) {
    if (url.protocol !== 'wss:' || url.host !== api.host) throw new Error('The voice server address is not trusted')
  } else if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    throw new Error('The voice server address is not valid')
  }
  return url
}

/** One voice signaling connection. The renderer never sees the ticket. */
export class MediaSignal {
  private socket: WebSocket | null = null
  private ping: NodeJS.Timeout | null = null
  private closed = false

  constructor(private readonly handlers: MediaHandlers) {}

  async connect(channelId: string, token: string): Promise<ApiResult<true>> {
    if (!/^\d{1,19}$/.test(channelId)) return { ok: false, status: 0, error: 'Invalid channel' }
    const joined = await call<VoiceJoinResponse>('POST', `/v1/channels/${channelId}/voice`, undefined, token)
    if (!joined.ok) return joined
    let url: URL
    try { url = checkMediaUrl(joined.value.url, endpoint().base, app.isPackaged) } catch (error) {
      return { ok: false, status: 0, error: (error as Error).message }
    }
    if (this.closed) return { ok: false, status: 0, error: 'Voice was closed' }
    const { dispatcher } = endpoint()
    const socket = new WebSocket(url, { dispatcher: url.protocol === 'wss:' ? dispatcher : undefined })
    this.socket = socket
    return new Promise((resolve) => {
      let settled = false
      const settle = (result: ApiResult<true>) => { if (!settled) { settled = true; resolve(result) } }
      socket.addEventListener('open', () => {
        socket.send(JSON.stringify({ op: 'join', ticket: joined.value.ticket } satisfies MediaClientFrame))
        this.ping = setInterval(() => this.send({ op: 'ping' }), PING_INTERVAL_MS)
      })
      socket.addEventListener('message', (event) => {
        if (socket !== this.socket || typeof event.data !== 'string' || event.data.length > MAX_FRAME_BYTES) return
        let frame: MediaServerFrame
        try { frame = JSON.parse(event.data) as MediaServerFrame } catch { return }
        if (frame.op === 'pong') return
        if (frame.op === 'joined') settle({ ok: true, value: true })
        if (frame.op === 'error') settle({ ok: false, status: 0, error: frame.message })
        this.handlers.onFrame(frame)
      })
      socket.addEventListener('close', () => {
        if (socket !== this.socket) return
        this.cleanup()
        settle({ ok: false, status: 0, error: 'Could not reach the voice server.' })
        if (!this.closed) this.handlers.onClosed('The voice connection closed.')
      })
      socket.addEventListener('error', () => { /* A close event always follows. */ })
    })
  }

  /** Sends a frame from the renderer after checking its type and size. */
  sendFromRenderer(value: unknown): void {
    if (!value || typeof value !== 'object') return
    const op = (value as { op?: unknown }).op
    if (typeof op !== 'string' || !CLIENT_OPS.has(op)) return
    this.send(value as MediaClientFrame)
  }

  private send(frame: MediaClientFrame): void {
    const text = JSON.stringify(frame)
    if (text.length > MAX_FRAME_BYTES || this.socket?.readyState !== WebSocket.OPEN) return
    this.socket.send(text)
  }

  close(): void {
    this.closed = true
    const socket = this.socket
    this.cleanup()
    socket?.close(1000)
  }

  private cleanup(): void {
    if (this.ping) clearInterval(this.ping)
    this.ping = null
    this.socket = null
  }
}
