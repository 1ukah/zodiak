import type { PlatformCapabilities } from '../shared/types'

export function getPlatformCapabilities(
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
): PlatformCapabilities {
  const windows = platform === 'win32'
  const linux = platform === 'linux'
  const wayland = linux && (environment.XDG_SESSION_TYPE === 'wayland' || Boolean(environment.WAYLAND_DISPLAY))
  return {
    capturePicker: wayland ? 'portal' : 'application',
    systemAudioCapture: windows || linux,
    discordAudioExclusion: windows || linux,
    // electron-updater replaces the running AppImage file, which it finds through
    // $APPIMAGE. Unpacked or extracted Linux builds have nothing it can replace.
    automaticUpdates: windows || (linux && Boolean(environment.APPIMAGE)),
  }
}
