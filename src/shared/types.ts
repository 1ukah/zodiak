export type Role = 'publisher' | 'viewer'

export interface AppConfig {
  url: string
  apiKey: string
  apiSecret: string
  displayName: string
  showStreamStatistics: boolean
  checkForUpdatesOnStartup: boolean
  chatPosition: 'right' | 'bottom'
  showChatBubbles: boolean
}

export interface RoomSummary {
  name: string
  participants: number
  sharing: boolean
}

/** Authoritative participant identity and display name from the LiveKit server. */
export interface RoomParticipantInfo {
  id: string
  name: string
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

export type ShareResolution = '480p' | '720p' | '1080p' | '1440p'
export type ShareFrameRate = 5 | 15 | 24 | 30 | 60 | 120
export type ShareBitrateMode = 'dynamic' | 'fixed'
export type SharePriority = 'quality' | 'framerate'

export interface ShareQuality {
  resolution: ShareResolution
  frameRate: ShareFrameRate
  /** Chooses Chromium's quality-versus-motion tradeoff when constrained. */
  priority: SharePriority
  bitrateMode: ShareBitrateMode
  bitrate: number
}

export interface ShareBitrateRange {
  min: number
  max: number
}

/** Adaptive bitrate bounds, in bits per second, for each quality profile. */
export const shareBitrateProfiles: Record<ShareResolution, Partial<Record<ShareFrameRate, ShareBitrateRange>>> = {
  '480p': { 5: { min: 150_000, max: 600_000 }, 15: { min: 400_000, max: 1_500_000 }, 24: { min: 600_000, max: 2_000_000 }, 30: { min: 750_000, max: 2_500_000 }, 60: { min: 1_200_000, max: 4_000_000 }, 120: { min: 3_500_000, max: 9_000_000 } },
  '720p': { 5: { min: 250_000, max: 1_000_000 }, 15: { min: 700_000, max: 2_500_000 }, 24: { min: 1_000_000, max: 3_500_000 }, 30: { min: 1_250_000, max: 4_500_000 }, 60: { min: 2_000_000, max: 7_500_000 }, 120: { min: 6_000_000, max: 16_000_000 } },
  '1080p': { 5: { min: 450_000, max: 1_800_000 }, 15: { min: 1_200_000, max: 4_500_000 }, 24: { min: 1_800_000, max: 6_500_000 }, 30: { min: 2_250_000, max: 8_000_000 }, 60: { min: 3_500_000, max: 12_000_000 } },
  '1440p': { 5: { min: 900_000, max: 3_500_000 }, 15: { min: 2_200_000, max: 8_000_000 }, 24: { min: 3_000_000, max: 11_000_000 }, 30: { min: 4_000_000, max: 14_000_000 }, 60: { min: 5_000_000, max: 20_000_000 } },
}

export function shareBitrateRangeFor(quality: Pick<ShareQuality, 'resolution' | 'frameRate'>): ShareBitrateRange {
  const range = shareBitrateProfiles[quality.resolution][quality.frameRate]
  if (!range) throw new Error(`Unsupported share quality: ${quality.resolution} at ${quality.frameRate} fps`)
  return range
}

export function supportsShareQuality(quality: Pick<ShareQuality, 'resolution' | 'frameRate'>): boolean {
  return shareBitrateProfiles[quality.resolution][quality.frameRate] !== undefined
}

export function shareBitrateFor(quality: ShareQuality): number {
  const range = shareBitrateRangeFor(quality)
  return quality.bitrateMode === 'fixed' ? quality.bitrate : range.max
}

export interface ShareStartRequest extends ShareRequest {
  quality: ShareQuality
}

/** Chromium GPU feature state, collected after Electron's GPU process starts. */
export interface CaptureAccelerationStatus {
  ready: boolean
  videoEncode: string
  videoDecode: string
  compositing: string
}

export type ActionResult<T> = { ok: true; value: T } | { ok: false; error: string }

export const channels = {
  rendererReady: 'app:renderer-ready',
  getConfig: 'config:get',
  saveConfig: 'config:save',
  checkForUpdates: 'update:check',
  createToken: 'token:create',
  listRooms: 'rooms:list',
  listRoomParticipants: 'rooms:list-participants',
  createRoom: 'rooms:create',
  deleteRoom: 'rooms:delete',
  listSources: 'sources:list',
  prepareShare: 'share:prepare',
  getCaptureAcceleration: 'share:acceleration',
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
  checkForUpdates: () => Promise<ActionResult<true>>
  createToken: (request: TokenRequest) => Promise<ActionResult<TokenResponse>>
  listRooms: () => Promise<ActionResult<RoomSummary[]>>
  listRoomParticipants: (request: RoomNameRequest) => Promise<ActionResult<RoomParticipantInfo[]>>
  createRoom: (request: CreateRoomRequest) => Promise<ActionResult<RoomSummary>>
  deleteRoom: (request: RoomNameRequest) => Promise<ActionResult<true>>
  listSources: () => Promise<ActionResult<DesktopSourceInfo[]>>
  prepareShare: (request: ShareStartRequest) => Promise<ActionResult<true>>
  getCaptureAcceleration: () => Promise<CaptureAccelerationStatus>
  setSharing: (active: boolean) => Promise<ActionResult<true>>
  startSystemAudio: (excludeDiscord: boolean) => Promise<ActionResult<true>>
  stopSystemAudio: () => Promise<ActionResult<true>>
  onSystemAudio: (listener: (pcm: Uint8Array) => void) => () => void
  setWindowFullscreen: (active: boolean) => Promise<ActionResult<boolean>>
  onWindowFullscreenChanged: (listener: (active: boolean) => void) => () => void
}
