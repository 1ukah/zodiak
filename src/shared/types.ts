export type UpdateChannel = 'stable' | 'beta'

export type UpdateAction = 'download' | 'install' | 'retry' | 'dismiss'
export interface UpdateState {
  revision: number
  phase: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'installing' | 'current' | 'error'
  visible: boolean
  channel: UpdateChannel
  version?: string
  progress?: { percent: number; transferred: number; total: number; bytesPerSecond: number }
  error?: string
  retry?: 'check' | 'download' | 'install'
}

export interface AppConfig {
  displayName: string
  showStreamStatistics: boolean
  checkForUpdatesOnStartup: boolean
  updateChannel: UpdateChannel
  /** Uses the GPU for rendering and video encode/decode; off forces CPU. Applies after a restart. */
  hardwareAcceleration: boolean
  voiceEnabled: boolean
  voiceInputDeviceId: string
  voiceInputVolume: number
  voiceNoiseSuppression: boolean
  voiceSuppressionStrength: number
  voiceEchoCancellation: boolean
  voiceAutoGainControl: boolean
  voiceNoiseGate: boolean
  voiceAutoInputSensitivity: boolean
  voiceInputSensitivity: number
}

export interface DesktopSourceInfo {
  id: string
  name: string
  thumbnail: string
}

/** Wayland has no application-side source list: the desktop portal asks the user instead. */
export const PORTAL_SOURCE_ID = 'portal'

export interface PlatformCapabilities {
  capturePicker: 'application' | 'portal'
  systemAudioCapture: boolean
  discordAudioExclusion: boolean
  /** Windows installs and Linux AppImages can download and install updates. */
  automaticUpdates: boolean
}

export interface ShareRequest {
  sourceId: string
  withAudio: boolean
  /** Excludes Discord playback from the share; local playback is not changed. */
  blockDiscordAudio: boolean
}

export type ShareResolution = '480p' | '720p' | '1080p'
export type ShareFrameRate = 30 | 60
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

/** Bitrate bounds, in bits per second, for each preset. The maximum is the preset's cap. */
export const shareBitrateProfiles: Record<ShareResolution, Partial<Record<ShareFrameRate, ShareBitrateRange>>> = {
  '480p': { 30: { min: 400_000, max: 1_000_000 }, 60: { min: 600_000, max: 1_500_000 } },
  '720p': { 30: { min: 1_000_000, max: 2_500_000 }, 60: { min: 1_400_000, max: 3_500_000 } },
  '1080p': { 30: { min: 1_600_000, max: 4_000_000 }, 60: { min: 2_400_000, max: 6_000_000 } },
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
  getPlatformCapabilities: 'app:capabilities',
  saveConfig: 'config:save',
  checkForUpdates: 'update:check',
  getUpdateState: 'update:state:get',
  updateStateChanged: 'update:state:changed',
  updateAction: 'update:action',
  listSources: 'sources:list',
  prepareShare: 'share:prepare',
  getCaptureAcceleration: 'share:acceleration',
  setSharing: 'share:active',
  startSystemAudio: 'audio:start',
  stopSystemAudio: 'audio:stop',
  systemAudioData: 'audio:data',
  systemAudioError: 'audio:error',
  setWindowFullscreen: 'window:set-fullscreen',
  windowFullscreenChanged: 'window:fullscreen-changed',
  windowVisibilityChanged: 'window:visibility-changed',
  restartRequired: 'app:restart-required',
  relaunchApp: 'app:relaunch',
} as const

export interface SharescreenApi {
  rendererReady: () => void
  getConfig: () => Promise<AppConfig>
  getPlatformCapabilities: () => Promise<PlatformCapabilities>
  saveConfig: (config: AppConfig) => Promise<ActionResult<AppConfig>>
  checkForUpdates: (channel?: UpdateChannel) => Promise<ActionResult<true>>
  getUpdateState: () => Promise<UpdateState>
  onUpdateStateChanged: (listener: (state: UpdateState) => void) => () => void
  updateAction: (action: UpdateAction) => Promise<ActionResult<true>>
  listSources: () => Promise<ActionResult<DesktopSourceInfo[]>>
  prepareShare: (request: ShareStartRequest) => Promise<ActionResult<true>>
  getCaptureAcceleration: () => Promise<CaptureAccelerationStatus>
  setSharing: (active: boolean) => Promise<ActionResult<true>>
  startSystemAudio: (excludeDiscord: boolean) => Promise<ActionResult<true>>
  stopSystemAudio: () => Promise<ActionResult<true>>
  onSystemAudio: (listener: (pcm: Uint8Array) => void) => () => void
  onSystemAudioError: (listener: (message: string) => void) => () => void
  setWindowFullscreen: (active: boolean) => Promise<ActionResult<boolean>>
  onWindowFullscreenChanged: (listener: (active: boolean) => void) => () => void
  onWindowVisibilityChanged: (listener: (visible: boolean) => void) => () => void
  onRestartRequired: (listener: (hardwareAcceleration: boolean) => void) => () => void
  relaunchApp: () => Promise<void>
}
