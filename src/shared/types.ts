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
}

export type ActionResult<T> = { ok: true; value: T } | { ok: false; error: string }

export const channels = {
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
  getConfig: () => Promise<AppConfig>
  saveConfig: (config: AppConfig) => Promise<ActionResult<AppConfig>>
  createToken: (request: TokenRequest) => Promise<ActionResult<TokenResponse>>
  listRooms: () => Promise<ActionResult<RoomSummary[]>>
  createRoom: (request: CreateRoomRequest) => Promise<ActionResult<RoomSummary>>
  deleteRoom: (request: RoomNameRequest) => Promise<ActionResult<true>>
  listSources: () => Promise<ActionResult<DesktopSourceInfo[]>>
  prepareShare: (request: ShareRequest) => Promise<ActionResult<true>>
  setSharing: (active: boolean) => Promise<ActionResult<true>>
  startSystemAudio: () => Promise<ActionResult<true>>
  stopSystemAudio: () => Promise<ActionResult<true>>
  onSystemAudio: (listener: (pcm: Uint8Array) => void) => () => void
}
