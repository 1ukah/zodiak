import { randomBytes } from 'node:crypto'
import { AccessToken, ParticipantInfo_State, TrackSource, type ParticipantInfo } from 'livekit-server-sdk'
import type { TokenRequest, TokenResponse } from '../shared/types'
import { requireDisplayName, requireRoom } from './config'
import { connectServer, explainLiveKitError, isMissingRoom, type LiveKitServer } from './livekit'
import { isRecord } from './parse'
import { listRoomParticipants } from './rooms'

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
    if (request.role === 'publisher') await assertNobodySharing(server, request.room)
    const identity = identityFor(request.displayName)
    const token = new AccessToken(server.apiKey, server.apiSecret, {
      identity,
      name: request.displayName,
      ttl: '6h',
      metadata: JSON.stringify({ role: request.role }),
    })
    if (request.role === 'publisher') {
      token.addGrant({
        roomJoin: true,
        room: request.room,
        canPublish: true,
        canSubscribe: true,
        canPublishData: false,
        canUpdateOwnMetadata: false,
        canPublishSources: [TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO],
      })
    } else {
      token.addGrant({
        roomJoin: true,
        room: request.room,
        canPublish: false,
        canSubscribe: true,
        canPublishData: false,
        canUpdateOwnMetadata: false,
      })
    }
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

async function assertNobodySharing(server: LiveKitServer, room: string): Promise<void> {
  let participants: ParticipantInfo[]
  try {
    participants = await listRoomParticipants(server.client, server.signalUrl, room)
  } catch (error) {
    if (isMissingRoom(error)) throw new Error('That room no longer exists')
    throw error
  }
  const sharer = participants.find((participant) => isOnline(participant) && isSharer(participant))
  if (!sharer) return
  throw new Error(`${sharer.name || sharer.identity || 'Someone'} is already sharing in this room.`)
}

function isOnline(participant: ParticipantInfo): boolean {
  return participant.state !== ParticipantInfo_State.DISCONNECTED
}

function isSharer(participant: ParticipantInfo): boolean {
  if (participant.permission?.canPublish === true) return true
  return participant.tracks.some((track) => track.source === TrackSource.SCREEN_SHARE)
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
