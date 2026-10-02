import { randomBytes } from 'node:crypto'
import { AccessToken, TrackSource } from 'livekit-server-sdk'
import type { TokenRequest, TokenResponse } from '../shared/types'
import { requireDisplayName, requireRoom } from './config'
import { connectServer, explainLiveKitError } from './livekit'
import { isRecord } from './parse'

export function parseTokenRequest(value: unknown): TokenRequest {
  if (!isRecord(value)) throw new Error('Invalid token request')
  const role = value.role
  if (role !== 'publisher' && role !== 'viewer') throw new Error('Invalid room role')
  return {
    role,
    displayName: requireDisplayName(value.displayName),
    room: requireRoom(value.room),
  }
}

export async function createParticipantToken(value: unknown): Promise<TokenResponse> {
  const request = parseTokenRequest(value)
  const server = await connectServer()
  try {
    const identity = identityFor(request.displayName)
    const token = new AccessToken(server.apiKey, server.apiSecret, {
      identity,
      name: request.displayName,
      ttl: '6h',
      metadata: JSON.stringify({ role: request.role }),
    })
    // Room members can share screens, talk, and chat; cameras stay disabled.
    token.addGrant({
      roomJoin: true,
      room: request.room,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      // Lets a connected participant update their own display name without
      // granting access to any other participant's profile.
      canUpdateOwnMetadata: true,
      canPublishSources: [TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO, TrackSource.MICROPHONE],
    })
    return {
      token: await token.toJwt(),
      url: server.signalUrl,
      identity,
      room: request.room,
      role: request.role,
    }
  } catch (error) {
    throw explainLiveKitError(error, server.signalUrl)
  }
}


function identityFor(name: string): string {
  const slug = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
  return `${slug || 'user'}-${randomBytes(3).toString('hex')}`
}
