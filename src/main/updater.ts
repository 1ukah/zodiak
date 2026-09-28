import { app, BrowserWindow, dialog } from 'electron'
import electronUpdater, { type ProgressInfo, type UpdateInfo } from 'electron-updater'
import { loadConfig } from './config'

const { autoUpdater } = electronUpdater

let getWindow: () => BrowserWindow | null = () => null
let updateCheckInFlight = false
let manualCheckRequested = false
let downloadStarted = false

function activeWindow(): BrowserWindow | null {
  const win = getWindow()
  return win && !win.isDestroyed() ? win : null
}

async function showMessage(options: Electron.MessageBoxOptions): Promise<number> {
  const win = activeWindow()
  const result = win
    ? await dialog.showMessageBox(win, options)
    : await dialog.showMessageBox(options)
  return result.response
}

function clearProgress(): void {
  activeWindow()?.setProgressBar(-1)
}

async function handleUpdateAvailable(info: UpdateInfo): Promise<void> {
  const response = await showMessage({
    type: 'info',
    title: 'Update available',
    message: `zodiak ${info.version} is available.`,
    detail: 'Download the update now? It will be installed only after you choose to restart zodiak.',
    buttons: ['Download', 'Later'],
    defaultId: 0,
    cancelId: 1,
  })
  if (response !== 0 || downloadStarted) return

  downloadStarted = true
  try {
    await autoUpdater.downloadUpdate()
  } catch (error) {
    clearProgress()
    downloadStarted = false
    console.warn('Could not download zodiak update:', error)
    await showMessage({
      type: 'error',
      title: 'Update download failed',
      message: 'zodiak could not download the update.',
      detail: 'Check your internet connection and try again later.',
      buttons: ['OK'],
    })
  }
}

async function handleUpdateDownloaded(info: UpdateInfo): Promise<void> {
  clearProgress()
  const response = await showMessage({
    type: 'info',
    title: 'Update ready',
    message: `zodiak ${info.version} is ready to install.`,
    detail: 'Restarting will close zodiak, run the installer, and open the updated version.',
    buttons: ['Restart and install', 'Later'],
    defaultId: 0,
    cancelId: 1,
  })
  if (response === 0) autoUpdater.quitAndInstall()
}

/** Configures the packaged-app updater once Electron is ready. */
export function initializeUpdater(windowProvider: () => BrowserWindow | null): void {
  getWindow = windowProvider
  if (!app.isPackaged) return

  // A user must explicitly agree before bytes are downloaded or an installer runs.
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.on('update-available', (info) => { void handleUpdateAvailable(info) })
  autoUpdater.on('update-not-available', () => {
    if (!manualCheckRequested) return
    manualCheckRequested = false
    void showMessage({
      type: 'info',
      title: 'zodiak is up to date',
      message: `You already have the latest version (${app.getVersion()}).`,
      buttons: ['OK'],
    })
  })
  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    activeWindow()?.setProgressBar(progress.percent / 100)
  })
  autoUpdater.on('update-downloaded', (info) => { void handleUpdateDownloaded(info) })
  // An update check can legitimately fail while offline. Download errors receive
  // a user-facing message at the point where the user requested the download.
  autoUpdater.on('error', (error) => console.warn('zodiak updater error:', error))
}

export async function requestUpdateCheck(manual = false): Promise<void> {
  if (!app.isPackaged) {
    if (manual) throw new Error('Updates are available only in an installed zodiak build')
    return
  }
  if (updateCheckInFlight) return

  updateCheckInFlight = true
  manualCheckRequested ||= manual
  try {
    await autoUpdater.checkForUpdates()
  } catch (error) {
    console.warn('Could not check for zodiak updates:', error)
    if (manual) {
      await showMessage({
        type: 'error',
        title: 'Update check failed',
        message: 'zodiak could not check for updates.',
        detail: 'Check your internet connection and try again.',
        buttons: ['OK'],
      })
    }
  } finally {
    updateCheckInFlight = false
  }
}

/** Starts the optional startup check only after the main window is visible. */
export async function checkForUpdatesOnStartup(): Promise<void> {
  const config = await loadConfig()
  if (config.checkForUpdatesOnStartup) await requestUpdateCheck()
}
