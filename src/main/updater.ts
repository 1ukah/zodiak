import { app, BrowserWindow } from 'electron'
import electronUpdater, { type AppUpdater, type ProgressInfo } from 'electron-updater'
import { getPlatformCapabilities } from './platform'
import { loadConfig, requireUpdateChannel } from './config'
import { getUpdateFeed } from './update-feed'
import { channels, type UpdateChannel, type UpdateState } from '../shared/types'

let autoUpdater: AppUpdater
let getWindow: () => BrowserWindow | null = () => null
let updateCheckInFlight = false
let manualCheckRequested = false
let activeChannel: UpdateChannel = 'stable'
let state: UpdateState = { revision: 0, phase: 'idle', visible: false, channel: 'stable' }

function activeWindow(): BrowserWindow | null {
  const win = getWindow()
  return win && !win.isDestroyed() ? win : null
}

export function getUpdateState(): UpdateState { return state }

function publish(next: Omit<UpdateState, 'revision' | 'channel'>): void {
  state = { ...next, channel: activeChannel, revision: state.revision + 1 }
  activeWindow()?.webContents.send(channels.updateStateChanged, state)
}

function clearProgress(): void { activeWindow()?.setProgressBar(-1) }

async function download(): Promise<void> {
  const version = state.version
  publish({ phase: 'downloading', visible: true, version })
  activeWindow()?.setProgressBar(2) // Indeterminate until the first measured sample.
  try {
    await autoUpdater.downloadUpdate()
  } catch (error) {
    clearProgress()
    console.warn('Could not download zodiak update:', error)
    publish({ phase: 'error', visible: true, version, retry: 'download', error: 'Check your connection and try again.' })
  }
}

/** Only explicit renderer actions may download or start the installer. */
export async function performUpdateAction(action: unknown): Promise<void> {
  if (action !== 'download' && action !== 'install' && action !== 'retry' && action !== 'dismiss') {
    throw new Error('Invalid update action')
  }
  if (!getPlatformCapabilities().automaticUpdates) throw new Error('Install a new package to update this application')
  if (!app.isPackaged) throw new Error('Updates are available only in an installed zodiak build')
  if (action === 'dismiss') {
    if (state.phase === 'downloading' || state.phase === 'installing' || state.phase === 'checking') return
    // A ready installer remains tied to its channel and can be reopened later.
    if (state.phase === 'available' || (state.phase === 'error' && state.retry !== 'install')) publish({ phase: 'idle', visible: false })
    else publish({ ...state, visible: false })
    return
  }
  if ((action === 'download' && state.phase === 'available') ||
      (action === 'retry' && state.phase === 'error' && state.retry === 'download')) {
    await download()
    return
  }
  if ((action === 'install' && state.phase === 'downloaded') ||
      (action === 'retry' && state.phase === 'error' && state.retry === 'install')) {
    publish({ phase: 'installing', visible: true, version: state.version })
    // The downloaded WPF setup shows its update window; the embedded NSIS stays silent.
    try { autoUpdater.quitAndInstall(true, true) }
    catch (error) {
      console.warn('Could not start zodiak update installer:', error)
      publish({ phase: 'error', visible: true, version: state.version, retry: 'install', error: 'Could not start the installer. Try again.' })
    }
    return
  }
  if (action === 'retry' && state.phase === 'error' && state.retry === 'check') {
    await requestUpdateCheck(true, activeChannel)
    return
  }
  throw new Error('This update action is no longer available')
}

/** Configures the packaged-app updater once Electron is ready. */
export function initializeUpdater(windowProvider: () => BrowserWindow | null): void {
  getWindow = windowProvider
  if (!app.isPackaged || !getPlatformCapabilities().automaticUpdates) return
  autoUpdater = electronUpdater.autoUpdater
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  // Published releases contain the complete custom setup, without blockmaps.
  autoUpdater.disableDifferentialDownload = true
  autoUpdater.on('update-available', (info) => {
    manualCheckRequested = false
    publish({ phase: 'available', visible: true, version: info.version })
  })
  autoUpdater.on('update-not-available', () => {
    publish({ phase: 'current', visible: manualCheckRequested, version: app.getVersion() })
    manualCheckRequested = false
  })
  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    if (state.phase !== 'downloading') return
    activeWindow()?.setProgressBar(progress.percent / 100)
    publish({ phase: 'downloading', visible: true, version: state.version,
      progress: { percent: progress.percent, transferred: progress.transferred, total: progress.total, bytesPerSecond: progress.bytesPerSecond } })
  })
  autoUpdater.on('update-downloaded', (info) => {
    clearProgress()
    publish({ phase: 'downloaded', visible: true, version: info.version })
  })
  autoUpdater.on('error', (error) => {
    console.warn('zodiak updater error:', error)
    if (state.phase === 'installing') {
      publish({ phase: 'error', visible: true, version: state.version, retry: 'install', error: 'Could not start the installer. Try again.' })
    }
  })
}

export async function requestUpdateCheck(manual = false, requestedChannel?: unknown): Promise<void> {
  if (!getPlatformCapabilities().automaticUpdates) {
    if (manual) throw new Error('Install a new package to update this application')
    return
  }
  if (!app.isPackaged) {
    if (manual) throw new Error('Updates are available only in an installed zodiak build')
    return
  }
  const pending = ['available', 'downloading', 'downloaded', 'installing'].includes(state.phase) ||
    (state.phase === 'error' && state.retry !== 'check')
  if (updateCheckInFlight || pending) {
    if (manual && !updateCheckInFlight && state.phase !== 'installing' &&
        (requestedChannel === undefined || requireUpdateChannel(requestedChannel) === activeChannel)) {
      publish({ ...state, visible: true })
      return
    }
    if (manual) throw new Error('An update is already being checked, downloaded, or waiting to install. Finish it before checking another channel.')
    return
  }

  updateCheckInFlight = true
  manualCheckRequested = manual
  try {
    activeChannel = requireUpdateChannel(requestedChannel ?? (await loadConfig()).updateChannel)
    publish({ phase: 'checking', visible: manual })
    autoUpdater.channel = activeChannel === 'beta' ? 'beta' : 'latest'
    autoUpdater.allowPrerelease = activeChannel === 'beta'
    const installedChannel: UpdateChannel = autoUpdater.currentVersion.prerelease[0] === 'beta' ? 'beta' : 'stable'
    autoUpdater.allowDowngrade = activeChannel !== installedChannel
    autoUpdater.setFeedURL(await getUpdateFeed(activeChannel))
    await autoUpdater.checkForUpdates()
  } catch (error) {
    console.warn('Could not check for zodiak updates:', error)
    publish({ phase: 'error', visible: manual, retry: 'check', error: 'Could not check for updates. Try again.' })
  } finally {
    updateCheckInFlight = false
    manualCheckRequested = false
  }
}

/** Starts the optional startup check only after the main window is visible. */
export async function checkForUpdatesOnStartup(): Promise<void> {
  const config = await loadConfig()
  if (config.checkForUpdatesOnStartup) await requestUpdateCheck(false, config.updateChannel)
}
