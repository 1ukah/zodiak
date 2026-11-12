import { WebSocket } from 'undici'
import type { GatewayEvent, GatewayServerFrame } from '../../shared/protocol'
import type { GatewayState } from '../../shared/zodiak'
import { endpoint } from './endpoint'

const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000]
const AUTHENTICATION_FAILED = 4004

export interface GatewayHandlers {
  onEvent: (event: GatewayEvent) => void
  onState: (state: GatewayState) => void
  /** The server rejected the token. The session is over. */
  onInvalidSession: () => void
}

/** One live-event connection for the signed-in user. Reconnects until stopped. */
export class Gateway {
  private socket: WebSocket | null = null
  private heartbeat: NodeJS.Timeout | null = null
  private reconnect: NodeJS.Timeout | null = null
  private attempts = 0
  private awaitingAck = false
  private stopped = false

  constructor(private readonly token: string, private readonly handlers: GatewayHandlers) {}

  start(): void {
    this.stopped = false
    this.connect()
  }

  stop(): void {
    this.stopped = true
    this.clearTimers()
    const socket = this.socket
    this.socket = null
    socket?.close(1000)
    this.handlers.onState('offline')
  }

  private connect(): void {
    if (this.stopped) return
    this.handlers.onState('connecting')
    let socket: WebSocket
    try {
      const { base, dispatcher } = endpoint()
      const url = new URL('/v1/gateway', base)
      url.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:'
      socket = new WebSocket(url, { dispatcher })
    } catch (error) {
      console.warn('Could not open the Zodiak gateway:', error)
      this.scheduleReconnect()
      return
    }
    this.socket = socket
    socket.addEventListener('message', (message) => {
      if (socket !== this.socket || typeof message.data !== 'string') return
      let frame: GatewayServerFrame
      try { frame = JSON.parse(message.data) as GatewayServerFrame } catch { return }
      this.handleFrame(socket, frame)
    })
    socket.addEventListener('close', (event) => {
      if (socket !== this.socket) return
      this.socket = null
      this.clearTimers()
      if (this.stopped) {
        this.handlers.onState('offline')
        return
      }
      if (event.code === AUTHENTICATION_FAILED) {
        this.stopped = true
        this.handlers.onState('offline')
        this.handlers.onInvalidSession()
        return
      }
      this.scheduleReconnect()
    })
    socket.addEventListener('error', () => { /* A close event always follows. */ })
  }

  private handleFrame(socket: WebSocket, frame: GatewayServerFrame): void {
    switch (frame.op) {
      case 'hello':
        socket.send(JSON.stringify({ op: 'identify', d: { token: this.token } }))
        this.startHeartbeat(socket, frame.d.heartbeat_interval_ms)
        return
      case 'heartbeat_ack':
        this.awaitingAck = false
        return
      case 'invalid_session':
        if (this.stopped) return
        this.stopped = true
        this.handlers.onInvalidSession()
        return
      case 'dispatch': {
        const { op: _op, s: _s, ...event } = frame
        if (event.t === 'READY') {
          this.attempts = 0
          this.handlers.onState('ready')
        }
        this.handlers.onEvent(event as GatewayEvent)
      }
    }
  }

  private startHeartbeat(socket: WebSocket, intervalMs: number): void {
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.awaitingAck = false
    this.heartbeat = setInterval(() => {
      if (this.awaitingAck) {
        // No answer to the last heartbeat: the connection is dead.
        socket.close(4000)
        return
      }
      this.awaitingAck = true
      socket.send(JSON.stringify({ op: 'heartbeat' }))
    }, Math.max(5_000, intervalMs))
  }

  private scheduleReconnect(): void {
    if (this.stopped) return
    this.handlers.onState('connecting')
    const delay = RECONNECT_DELAYS_MS[Math.min(this.attempts, RECONNECT_DELAYS_MS.length - 1)]
    this.attempts++
    this.reconnect = setTimeout(() => this.connect(), delay)
  }

  private clearTimers(): void {
    if (this.heartbeat) clearInterval(this.heartbeat)
    if (this.reconnect) clearTimeout(this.reconnect)
    this.heartbeat = null
    this.reconnect = null
  }
}
