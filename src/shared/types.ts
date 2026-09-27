export type Role = 'publisher' | 'viewer'

export interface AppConfig {
  url: string
  apiKey: string
  apiSecret: string
  displayName: string
}

export interface RoomSummary {
  name: string
  participants: number
  sharing: boolean
}

export interface CreateRoomRequest {
  name: string
  displayName: string
}

export interface RoomNameRequest {
  name: string
}

export interface TokenRequest {
  role: Role
  displayName: string
  room: string
}

export interface TokenResponse {
  token: string
  url: string
  identity: string
  room: string
  role: Role
}

export interface DesktopSourceInfo {
  id: string
  name: string
  thumbnail: string
}

export interface ShareRequest {
  sourceId: string
  withAudio: boolean
  /** Capture Windows loopback with Discord's process tree excluded. */
  blockDiscordAudio: boolean
}

export type ShareResolution = '480p' | '720p' | '1080p' | '4k'
export type ShareFrameRate = 15 | 24 | 30 | 60

export interface ShareQuality {
  resolution: ShareResolution
  frameRate: ShareFrameRate
}

export const shareBitrateProfiles: Record<ShareResolution, Record<ShareFrameRate, number>> = {
  '480p': { 15: 1_500_000, 24: 2_000_000, 30: 2_500_000, 60: 4_000_000 },
  '720p': { 15: 2_500_000, 24: 3_500_000, 30: 4_500_000, 60: 7_500_000 },
  '1080p': { 15: 4_500_000, 24: 6_500_000, 30: 8_000_000, 60: 12_000_000 },
  '4k': { 15: 12_000_000, 24: 25_000_000, 30: 30_000_000, 60: 45_000_000 },
}

export function shareBitrateFor(quality: ShareQuality): number {
  return shareBitrateProfiles[quality.resolution][quality.frameRate]
}

export interface ShareStartRequest extends ShareRequest {
  quality: ShareQuality
}

export type ActionResult<T> = { ok: true; value: T } | { ok: false; error: string }

export const channels = {
  rendererReady: 'app:renderer-ready',
  getConfig: 'config:get',
  saveConfig: 'config:save',
  createToken: 'token:create',
  listRooms: 'rooms:list',
  createRoom: 'rooms:create',
  deleteRoom: 'rooms:delete',
  listSources: 'sources:list',
  prepareShare: 'share:prepare',
  setSharing: 'share:active',
  startSystemAudio: 'audio:start',
  stopSystemAudio: 'audio:stop',
  systemAudioData: 'audio:data',
} as const

export interface SharescreenApi {
  rendererReady: () => void
  getConfig: () => Promise<AppConfig>
  saveConfig: (config: AppConfig) => Promise<ActionResult<AppConfig>>
  createToken: (request: TokenRequest) => Promise<ActionResult<TokenResponse>>
  listRooms: () => Promise<ActionResult<RoomSummary[]>>
  createRoom: (request: CreateRoomRequest) => Promise<ActionResult<RoomSummary>>
  deleteRoom: (request: RoomNameRequest) => Promise<ActionResult<true>>
  listSources: () => Promise<ActionResult<DesktopSourceInfo[]>>
  prepareShare: (request: ShareStartRequest) => Promise<ActionResult<true>>
  setSharing: (active: boolean) => Promise<ActionResult<true>>
  startSystemAudio: () => Promise<ActionResult<true>>
  stopSystemAudio: () => Promise<ActionResult<true>>
  onSystemAudio: (listener: (pcm: Uint8Array) => void) => () => void
}
