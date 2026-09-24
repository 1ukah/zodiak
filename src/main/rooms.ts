import { RoomServiceClient, type ParticipantInfo } from 'livekit-server-sdk'
import type { CreateRoomRequest, RoomSummary } from '../shared/types'
import { requireDisplayName, requireRoom } from './config'
import { connectServer, explainLiveKitError, isMissingRoom, withTimeout } from './livekit'
import { isRecord } from './parse'

const ROOM_TTL_SECONDS = 60 * 60 * 24 * 30

export function parseCreateRoom(value: unknown): CreateRoomRequest {
  if (!isRecord(value)) throw new Error('Invalid room')
  return {
    name: requireRoom(value.name),
    displayName: requireDisplayName(value.displayName),
  }
}

export function parseRoomName(value: unknown): string {
  if (!isRecord(value)) throw new Error('Invalid room')
  return requireRoom(value.name)
}

export async function listLiveRooms(): Promise<RoomSummary[]> {
  const server = await connectServer()
  try {
    const rooms = await withTimeout(
      server.client.listRooms(),
      8000,
      `Could not reach the LiveKit server at ${server.signalUrl}.`,
    )
    return rooms
      .filter((room) => room.name.length > 0)
      .map((room) => ({
        name: room.name,
        participants: room.numParticipants,
        sharing: room.numPublishers > 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch (error) {
    throw explainLiveKitError(error, server.signalUrl)
  }
}

export async function createLiveRoom(value: unknown): Promise<RoomSummary> {
  const request = parseCreateRoom(value)
  const server = await connectServer()
  try {
    const existing = await withTimeout(
      server.client.listRooms([request.name]),
      8000,
      `Could not reach the LiveKit server at ${server.signalUrl}.`,
    )
    if (existing.length > 0) throw new Error('A room with that name already exists')
    const room = await server.client.createRoom({
      name: request.name,
      emptyTimeout: ROOM_TTL_SECONDS,
      departureTimeout: ROOM_TTL_SECONDS,
      metadata: JSON.stringify({ createdBy: request.displayName }),
    })
    return {
      name: room.name,
      participants: room.numParticipants,
      sharing: room.numPublishers > 0,
    }
  } catch (error) {
    throw explainLiveKitError(error, server.signalUrl)
  }
}

export async function deleteLiveRoom(value: unknown): Promise<true> {
  const name = parseRoomName(value)
  const server = await connectServer()
  try {
    await withTimeout(
      server.client.deleteRoom(name),
      8000,
      `Could not reach the LiveKit server at ${server.signalUrl}.`,
    )
    return true
  } catch (error) {
    if (isMissingRoom(error)) return true
    throw explainLiveKitError(error, server.signalUrl)
  }
}

export function listRoomParticipants(
  client: RoomServiceClient,
  signalUrl: string,
  room: string,
): Promise<ParticipantInfo[]> {
  return withTimeout(client.listParticipants(room), 8000, `Could not reach the LiveKit server at ${signalUrl}.`)
}
