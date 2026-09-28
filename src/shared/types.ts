export type Role = 'publisher' | 'viewer'

export interface AppConfig {
  url: string
  apiKey: string
  apiSecret: string
  displayName: string
  showStreamStatistics: boolean
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
  /** Temporarily blocks Discord audio from a system-audio share. */
  blockDiscordAudio: boolean
}

export type ShareResolution = '480p' | '720p' | '1080p' | '1440p' | '4k'
export type ShareFrameRate = 5 | 15 | 24 | 30 | 60
export type ShareBitrateMode = 'dynamic' | 'fixed'

export interface ShareQuality {
  resolution: ShareResolution
  frameRate: ShareFrameRate
  bitrateMode: ShareBitrateMode
  bitrate: number
}

export interface ShareBitrateRange {
  min: number
  max: number
}

/** Adaptive bitrate bounds, in bits per second, for each quality profile. */
export const shareBitrateProfiles: Record<ShareResolution, Record<ShareFrameRate, ShareBitrateRange>> = {
  '480p': { 5: { min: 150_000, max: 600_000 }, 15: { min: 400_000, max: 1_500_000 }, 24: { min: 600_000, max: 2_000_000 }, 30: { min: 750_000, max: 2_500_000 }, 60: { min: 1_200_000, max: 4_000_000 } },
  '720p': { 5: { min: 250_000, max: 1_000_000 }, 15: { min: 700_000, max: 2_500_000 }, 24: { min: 1_000_000, max: 3_500_000 }, 30: { min: 1_250_000, max: 4_500_000 }, 60: { min: 2_000_000, max: 7_500_000 } },
  '1080p': { 5: { min: 450_000, max: 1_800_000 }, 15: { min: 1_200_000, max: 4_500_000 }, 24: { min: 1_800_000, max: 6_500_000 }, 30: { min: 2_250_000, max: 8_000_000 }, 60: { min: 3_500_000, max: 12_000_000 } },
  '1440p': { 5: { min: 900_000, max: 3_500_000 }, 15: { min: 2_200_000, max: 8_000_000 }, 24: { min: 3_000_000, max: 11_000_000 }, 30: { min: 4_000_000, max: 14_000_000 }, 60: { min: 5_000_000, max: 20_000_000 } },
  '4k': { 5: { min: 1_500_000, max: 6_000_000 }, 15: { min: 4_000_000, max: 12_000_000 }, 24: { min: 6_000_000, max: 25_000_000 }, 30: { min: 8_000_000, max: 30_000_000 }, 60: { min: 12_000_000, max: 45_000_000 } },
}

export function shareBitrateRangeFor(quality: Pick<ShareQuality, 'resolution' | 'frameRate'>): ShareBitrateRange {
  return shareBitrateProfiles[quality.resolution][quality.frameRate]
}

export function shareBitrateFor(quality: ShareQuality): number {
  const range = shareBitrateRangeFor(quality)
  return quality.bitrateMode === 'fixed' ? quality.bitrate : range.max
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
  setWindowFullscreen: 'window:set-fullscreen',
  windowFullscreenChanged: 'window:fullscreen-changed',
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
  startSystemAudio: (excludeDiscord: boolean) => Promise<ActionResult<true>>
  stopSystemAudio: () => Promise<ActionResult<true>>
  onSystemAudio: (listener: (pcm: Uint8Array) => void) => () => void
  setWindowFullscreen: (active: boolean) => Promise<ActionResult<boolean>>
  onWindowFullscreenChanged: (listener: (active: boolean) => void) => () => void
}
