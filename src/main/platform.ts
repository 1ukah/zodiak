import type { PlatformCapabilities } from '../shared/types'

export function getPlatformCapabilities(
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
): PlatformCapabilities {
  const windows = platform === 'win32'
  const wayland = platform === 'linux' && (environment.XDG_SESSION_TYPE === 'wayland' || Boolean(environment.WAYLAND_DISPLAY))
  return {
    capturePicker: wayland ? 'portal' : 'application',
    systemAudioCapture: windows,
    discordAudioExclusion: windows,
    automaticUpdates: windows,
  }
}
