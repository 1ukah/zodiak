/** Versioned, bounded packets carried by the room's authenticated data channel. */
export const CHAT_TOPIC = 'zodiak.chat.v1'
export const CHAT_MAX_LENGTH = 2_000
export const CHAT_MAX_BYTES = 10_000

export interface ChatPacket {
  version: 1
  id: string
  text: string
  timestamp: number
  recipient?: string
}

export interface ChatMessage extends ChatPacket {
  senderId: string
  senderName: string
  local: boolean
}

export function parseChatPacket(data: Uint8Array): ChatPacket | null {
  if (data.byteLength > CHAT_MAX_BYTES) return null
  try {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data))
    if (!value || value.version !== 1 || typeof value.id !== 'string' || !/^[\w-]{1,80}$/.test(value.id)
      || typeof value.text !== 'string' || !value.text.trim() || value.text.length > CHAT_MAX_LENGTH
      || !Number.isSafeInteger(value.timestamp) || value.timestamp < 0
      || (value.recipient !== undefined && (typeof value.recipient !== 'string' || !value.recipient || value.recipient.length > 256))) return null
    return { version: 1, id: value.id, text: value.text, timestamp: value.timestamp, ...(value.recipient ? { recipient: value.recipient } : {}) }
  } catch { return null }
}
