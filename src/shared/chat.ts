/** Versioned, bounded packets carried by the room's authenticated data channel. */
export const CHAT_TOPIC = 'zodiak.chat.v1'
export const CHAT_MAX_LENGTH = 2_000
export const CHAT_MAX_BYTES = 10_000
export const CHAT_IMAGE_TOPIC = 'zodiak.chat.image.v1'
export const CHAT_IMAGE_MAX_BYTES = 10 * 1024 * 1024
export const CHAT_IMAGE_MAX_COUNT = 10
export const CHAT_IMAGE_BATCH_MAX_BYTES = CHAT_IMAGE_MAX_COUNT * CHAT_IMAGE_MAX_BYTES
export const CHAT_IMAGE_PACKET_MAX_BYTES = 32_000
export const CHAT_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'] as const
export const CHAT_IMAGE_ACCEPT = CHAT_IMAGE_TYPES.join(',')

export interface ChatImageInfo {
  name: string
  mimeType: string
  size: number
}

export interface ChatImage extends ChatImageInfo { blob: Blob }
export interface ChatImagePacket extends ChatPacket { images: ChatImageInfo[] }

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
  images?: ChatImage[]
  imageExpired?: boolean
}

export function parseChatPacket(data: Uint8Array): ChatPacket | null {
  return parsePacket(data, false)
}

export function parseChatImagePacket(data: Uint8Array): ChatImagePacket | null {
  return parsePacket(data, true) as ChatImagePacket | null
}

function parsePacket(data: Uint8Array, withImage: boolean): ChatPacket | null {
  if (data.byteLength > (withImage ? CHAT_IMAGE_PACKET_MAX_BYTES : CHAT_MAX_BYTES)) return null
  try {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data))
    if (!value || value.version !== 1 || typeof value.id !== 'string' || !/^[\w-]{1,80}$/.test(value.id)
      || typeof value.text !== 'string' || (!withImage && !value.text.trim()) || value.text.length > CHAT_MAX_LENGTH
      || !Number.isSafeInteger(value.timestamp) || value.timestamp < 0
      || (value.recipient !== undefined && (typeof value.recipient !== 'string' || !value.recipient || value.recipient.length > 256))) return null
    const packet: ChatPacket = { version: 1, id: value.id, text: value.text, timestamp: value.timestamp, ...(value.recipient ? { recipient: value.recipient } : {}) }
    if (!withImage) return packet
    // Accept older single-image senders, normalizing to the current message shape.
    const images = value.images ?? (value.image ? [value.image] : null)
    if (!Array.isArray(images) || !images.length || images.length > CHAT_IMAGE_MAX_COUNT) return null
    for (const image of images) {
      if (!image || typeof image.name !== 'string' || !image.name.trim() || image.name.length > 256
        || !CHAT_IMAGE_TYPES.includes(image.mimeType) || !Number.isSafeInteger(image.size)
        || image.size <= 0 || image.size > CHAT_IMAGE_MAX_BYTES) return null
    }
    return { ...packet, images: images.map(({ name, mimeType, size }) => ({ name, mimeType, size })) } as ChatImagePacket
  } catch { return null }
}

/** Check the contents as well as the file chooser's declared MIME type. */
export async function validateChatImage(blob: Blob): Promise<void> {
  if (!CHAT_IMAGE_TYPES.includes(blob.type as typeof CHAT_IMAGE_TYPES[number])) throw new Error('Choose a PNG, JPEG, GIF, WebP, or AVIF image.')
  if (!blob.size || blob.size > CHAT_IMAGE_MAX_BYTES) throw new Error('Images must be between 1 byte and 10 MB.')
  const bytes = new Uint8Array(await blob.slice(0, 32).arrayBuffer())
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end))
  const valid = blob.type === 'image/png' ? [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)
    : blob.type === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : blob.type === 'image/gif' ? ['GIF87a', 'GIF89a'].includes(ascii(0, 6))
    : blob.type === 'image/webp' ? ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP'
    : ascii(4, 8) === 'ftyp' && [ascii(8, 12), ...Array.from({ length: 4 }, (_, i) => ascii(16 + i * 4, 20 + i * 4))].some(brand => brand === 'avif' || brand === 'avis')
  if (!valid) throw new Error('This file is not a valid supported image.')
}
