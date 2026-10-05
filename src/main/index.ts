import { app, BrowserWindow, dialog, ipcMain, nativeImage, powerSaveBlocker, session, shell } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { channels, shareBitrateRangeFor, supportsShareQuality, type CaptureAccelerationStatus, type ShareBitrateMode, type ShareFrameRate, type SharePriority, type ShareResolution, type ShareStartRequest } from '../shared/types'
import { armCapture, listSources, registerCaptureHandler } from './capture'
import { startSystemAudio, stopSystemAudio } from './system-audio'
import { loadConfig, saveConfig } from './config'
import { isRecord } from './parse'
import { settle } from './result'
import { getLocalIdentity } from './identity'
import { flushParticipantPreferences, getParticipantPreferences, saveParticipantPreferences } from './participant-preferences'

// Electron enables Chromium's GPU pipeline by default. This app deliberately
// never calls disableHardwareAcceleration; the renderer also reports Chromium's
// video_encode feature state before a share begins.
app.setName('zodiak')
if (process.platform === 'win32') app.setAppUserModelId('app.zodiak')

// Installed builds keep every app-managed file next to the executable, inside
// the directory the user selected in the installer. Development keeps its
// isolated profile so tests and local work never touch an installed profile.
if (app.isPackaged) {
  const dataDirectory = join(process.resourcesPath, '..', 'data')
  app.setPath('userData', dataDirectory)
  app.setPath('sessionData', join(dataDirectory, 'session'))
  app.setPath('logs', join(dataDirectory, 'logs'))
  app.setPath('crashDumps', join(dataDirectory, 'crash-dumps'))
}

let sleepBlocker: number | null = null
let gpuInfoReady = false
let startupUpdateCheckScheduled = false
let updaterInitialized = false

async function loadUpdater() {
  const updater = await import('./updater')
  if (!updaterInitialized) {
    updaterInitialized = true
    updater.initializeUpdater(() => BrowserWindow.getAllWindows()[0] ?? null)
  }
  return updater
}

// Electron documents GPU feature status as valid only after this event.
app.on('gpu-info-update', () => { gpuInfoReady = true })

let cachedAppIcon: ReturnType<typeof nativeImage.createFromPath> | undefined
function appIcon() {
  // Windows can load ICO directly. Passing the 6032px source PNG here made
  // each window spend nearly two seconds synchronously preparing its icon.
  if (process.platform === 'win32') {
    return app.isPackaged
      ? join(process.resourcesPath, 'app-icon.ico')
      : join(__dirname, '../../build/icon.ico')
  }
  if (!cachedAppIcon) {
    cachedAppIcon = nativeImage.createFromPath(app.isPackaged
      ? join(process.resourcesPath, 'app-icon.png')
      : join(__dirname, '../../build/icon.png')).resize({ width: 256, height: 256 })
  }
  return cachedAppIcon
}

function splashLogo() {
  const svgPath = app.isPackaged
    ? join(process.resourcesPath, 'logo.svg')
    : join(__dirname, '../../build/logo.svg')
  return `data:image/svg+xml;base64,${readFileSync(svgPath).toString('base64')}`
}

function createSplash(): BrowserWindow {
  const splash = new BrowserWindow({
    width: 360,
    height: 220,
    show: false,
    frame: false,
    resizable: false,
    backgroundColor: '#14151a',
    title: 'zodiak',
    icon: appIcon(),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  splash.setMenuBarVisibility(false)
  void splash.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(splashMarkup(splashLogo()))}`)
  return splash
}

function splashMarkup(brandIcon: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    :root { color-scheme: dark; } * { box-sizing: border-box; }
    body { margin:0; min-height:100vh; display:grid; place-items:center; background:#14151a; color:#eeeef2; font:14px "Segoe UI",sans-serif; border:1px solid #34323f; -webkit-app-region:drag; }
    main { width:240px; } .brand { display:flex; align-items:center; flex-direction:column; margin-bottom:22px; }
    .mark { width:80px; height:100px; display:block; } .track { height:3px; overflow:hidden; border-radius:9px; background:#30303c; }
    .bar { width:42%; height:100%; border-radius:inherit; background:#a8a0ff; animation:loading 1.35s ease-in-out infinite; }
    #status { margin:9px 0 0; color:#898b9b; font-size:10px; text-align:center; }
    @keyframes loading { from { transform:translateX(-120%); } to { transform:translateX(340%); } }
    @media(prefers-reduced-motion:reduce) { .bar { animation:none; width:100%; opacity:.6; } }
  </style></head><body><main><div class="brand"><img class="mark" src="${brandIcon}" alt="" /></div><div class="track" role="progressbar" aria-label="Loading"><div class="bar"></div></div><p id="status" role="status">Starting…</p></main>
  <script>window.setSplashStatus = (message) => { document.getElementById('status').textContent = message }</script></body></html>`
}

function updateSplash(splash: BrowserWindow | null, message: string): void {
  if (!splash || splash.isDestroyed()) return
  void splash.webContents.executeJavaScript(`window.setSplashStatus?.(${JSON.stringify(message)})`, true).catch(() => undefined)
}

function createWindow(splash: BrowserWindow | null = null): void {
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 920,
    minHeight: 640,
    show: false,
    backgroundColor: '#101114',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#9698a8', height: 32 },
    autoHideMenuBar: true,
    title: 'zodiak',
    icon: appIcon(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: true,
    },
  })

  win.on('page-title-updated', (event) => {
    event.preventDefault()
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    // Chat links open in the user's browser; never navigate the app or launch
    // file/custom protocols from a message.
    try {
      const link = new URL(url)
      if (['https:', 'http:'].includes(link.protocol) && !link.username && !link.password) void shell.openExternal(link.href).catch(() => undefined)
    } catch { /* Ignore malformed links. */ }
    return { action: 'deny' }
  })
  const notifyFullscreen = (active: boolean): void => {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channels.windowFullscreenChanged, active)
  }
  win.on('enter-full-screen', () => notifyFullscreen(true))
  win.on('leave-full-screen', () => notifyFullscreen(false))
  const notifyVisibility = (visible: boolean): void => {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channels.windowVisibilityChanged, visible)
  }
  win.on('minimize', () => notifyVisibility(false))
  win.on('restore', () => notifyVisibility(true))
  win.on('hide', () => notifyVisibility(false))
  win.on('show', () => notifyVisibility(true))
  win.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env.ELECTRON_RENDERER_URL
    if (devUrl && url.startsWith(devUrl)) return
    event.preventDefault()
  })

  win.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error(preloadPath, error)
  })

  win.webContents.on('did-start-loading', () => updateSplash(splash, 'Loading the interface…'))
  win.webContents.on('dom-ready', () => updateSplash(splash, 'Preparing screen sharing…'))

  let painted = false
  let rendererReady = false
  const showWindow = (): void => {
    if (win.isDestroyed() || !painted || !rendererReady) return
    clearTimeout(startupTimeout)
    ipcMain.removeListener(channels.rendererReady, onRendererReady)
    win.show()
    if (splash && !splash.isDestroyed()) splash.close()
    if (!startupUpdateCheckScheduled) {
      startupUpdateCheckScheduled = true
      void loadConfig().then(async config => {
        if (app.isPackaged && config.checkForUpdatesOnStartup) await (await loadUpdater()).checkForUpdatesOnStartup()
      }).catch(error => console.warn('Could not check for updates:', error))
    }
  }
  const onRendererReady = (event: Electron.IpcMainEvent): void => {
    if (event.sender !== win.webContents) return
    rendererReady = true
    showWindow()
  }
  ipcMain.on(channels.rendererReady, onRendererReady)
  const startupTimeout = setTimeout(() => {
    // Keep a broken preload or renderer from leaving an endless splash.
    if (win.isDestroyed()) return
    rendererReady = true
    painted = true
    showWindow()
    void dialog.showMessageBox(win, { type: 'error', title: 'Startup is taking longer than expected', message: 'zodiak could not finish starting.', detail: 'Close the app and try opening it again.' })
  }, 20_000)
  win.once('ready-to-show', () => { painted = true; showWindow() })

  win.on('closed', () => {
    clearTimeout(startupTimeout)
    ipcMain.removeListener(channels.rendererReady, onRendererReady)
    if (splash && !splash.isDestroyed()) splash.close()
  })

  win.webContents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
    if (!isMainFrame || code === -3) return
    clearTimeout(startupTimeout)
    dialog.showErrorBox('Could not open zodiak', description)
    win.close()
  })

  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) {
    void win.loadURL(devUrl)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function setSleepBlock(active: boolean): void {
  if (active) {
    if (sleepBlocker !== null && powerSaveBlocker.isStarted(sleepBlocker)) return
    sleepBlocker = powerSaveBlocker.start('prevent-display-sleep')
    return
  }
  if (sleepBlocker !== null && powerSaveBlocker.isStarted(sleepBlocker)) {
    powerSaveBlocker.stop(sleepBlocker)
  }
  sleepBlocker = null
}

function parseShareRequest(value: unknown): ShareStartRequest {
  if (!isRecord(value)) throw new Error('Choose a screen or window')
  if (typeof value.sourceId !== 'string' || value.sourceId.length === 0 || value.sourceId.length > 512) {
    throw new Error('Choose a screen or window')
  }
  if (typeof value.withAudio !== 'boolean') throw new Error('Invalid audio option')
  if (typeof value.blockDiscordAudio !== 'boolean') throw new Error('Invalid Discord audio option')
  if (!isRecord(value.quality)) throw new Error('Invalid share quality')
  const resolution = value.quality.resolution
  const frameRate = value.quality.frameRate
  const priority = value.quality.priority
  const bitrateMode = value.quality.bitrateMode
  const bitrate = value.quality.bitrate
  if (!isResolution(resolution) || !isFrameRate(frameRate) || !supportsShareQuality({ resolution, frameRate }) || !isPriority(priority) || !isBitrateMode(bitrateMode)) {
    throw new Error('This resolution and frame rate cannot be used together')
  }
  const bitrateRange = shareBitrateRangeFor({ resolution, frameRate })
  if (typeof bitrate !== 'number' || !Number.isInteger(bitrate) || bitrate < bitrateRange.min || bitrate > bitrateRange.max) {
    throw new Error('The fixed bitrate must be within the selected quality range')
  }
  if (value.blockDiscordAudio && !value.withAudio) throw new Error('Discord blocking requires system audio')
  return {
    sourceId: value.sourceId,
    withAudio: value.withAudio,
    blockDiscordAudio: value.blockDiscordAudio,
    quality: { resolution, frameRate, priority, bitrateMode, bitrate },
  }
}

function isResolution(value: unknown): value is ShareResolution {
  return value === '480p' || value === '720p' || value === '1080p' || value === '1440p'
}

function isFrameRate(value: unknown): value is ShareFrameRate {
  return value === 5 || value === 15 || value === 24 || value === 30 || value === 60 || value === 120
}

function isBitrateMode(value: unknown): value is ShareBitrateMode {
  return value === 'dynamic' || value === 'fixed'
}

function isPriority(value: unknown): value is SharePriority {
  return value === 'quality' || value === 'framerate'
}

function captureAccelerationStatus(): CaptureAccelerationStatus {
  if (!gpuInfoReady) {
    return { ready: false, videoEncode: 'checking', videoDecode: 'checking', compositing: 'checking' }
  }
  const status = app.getGPUFeatureStatus()
  return {
    ready: true,
    videoEncode: status.video_encode,
    videoDecode: status.video_decode,
    compositing: status.gpu_compositing,
  }
}

function registerIpc(): void {
  ipcMain.handle(channels.getConfig, async () => { await getLocalIdentity(); return loadConfig() })
  ipcMain.handle(channels.getParticipantPreferences, (_event, server: unknown) => settle(() => getParticipantPreferences(server)))
  ipcMain.handle(channels.saveParticipantPreferences, (_event, payload: unknown) => settle(async () => { await saveParticipantPreferences(payload); return true as const }))
  ipcMain.handle(channels.saveConfig, (_event, payload: unknown) => settle(async () => {
    const previous = await loadConfig()
    const saved = await saveConfig(payload)
    if (app.isPackaged && saved.updateChannel !== previous.updateChannel) {
      // Saving stays independent of network failures or a pending update prompt.
      void loadUpdater().then(updater => updater.requestUpdateCheck(true, saved.updateChannel))
        .catch(error => console.warn('Could not check the selected update channel:', error))
    }
    return saved
  }))
  ipcMain.handle(channels.checkForUpdates, (_event, channel: unknown) => settle(async () => {
    await (await loadUpdater()).requestUpdateCheck(true, channel)
    return true as const
  }))
  ipcMain.handle(channels.createToken, (_event, payload: unknown) => settle(async () => (await import('./tokens')).createParticipantToken(payload)))
  ipcMain.handle(channels.getUpdateState, async () => (await loadUpdater()).getUpdateState())
  ipcMain.handle(channels.updateAction, (_event, action: unknown) => settle(async () => {
    await (await loadUpdater()).performUpdateAction(action)
    return true as const
  }))
  ipcMain.handle(channels.listRooms, () => settle(async () => (await import('./rooms')).listLiveRooms()))
  ipcMain.handle(channels.listRoomParticipants, (_event, payload: unknown) => settle(async () => (await import('./rooms')).listLiveRoomParticipants(payload)))
  ipcMain.handle(channels.createRoom, (_event, payload: unknown) => settle(async () => (await import('./rooms')).createLiveRoom(payload)))
  ipcMain.handle(channels.deleteRoom, (_event, payload: unknown) => settle(async () => (await import('./rooms')).deleteLiveRoom(payload)))
  ipcMain.handle(channels.listSources, () => settle(() => listSources()))
  ipcMain.handle(channels.prepareShare, (_event, payload: unknown) =>
    settle(async () => {
      const request = parseShareRequest(payload)
      // System audio always uses the protected WASAPI track, which excludes
      // this app's process tree and prevents remote stream audio from looping.
      armCapture({ ...request, withAudio: false })
      return true as const
    }),
  )
  ipcMain.handle(channels.getCaptureAcceleration, () => captureAccelerationStatus())
  ipcMain.handle(channels.setSharing, (_event, payload: unknown) =>
    settle(async () => {
      if (typeof payload !== 'boolean') throw new Error('Invalid share state')
      setSleepBlock(payload)
      if (!payload) stopSystemAudio()
      return true as const
    }),
  )
  ipcMain.handle(channels.startSystemAudio, (event, excludeDiscord: unknown) =>
    settle(() => {
      if (typeof excludeDiscord !== 'boolean') throw new Error('Invalid Discord audio option')
      return startSystemAudio(event.sender, excludeDiscord)
    }),
  )
  ipcMain.handle(channels.stopSystemAudio, () =>
    settle(async () => {
      stopSystemAudio()
      return true as const
    }),
  )
  ipcMain.handle(channels.setWindowFullscreen, (event, payload: unknown) =>
    settle(async () => {
      if (typeof payload !== 'boolean') throw new Error('Invalid fullscreen state')
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win || win.isDestroyed()) throw new Error('Application window is unavailable')
      win.setFullScreen(payload)
      return payload
    }),
  )
}

function registerPermissions(): void {
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(permission === 'media' || permission === 'display-capture' || permission === 'speaker-selection')
  })
  registerCaptureHandler()
}

// Multiple launches must not create independent Chromium/GPU/audio process trees.
const primaryInstance = app.requestSingleInstanceLock()
if (!primaryInstance) app.quit()
app.on('second-instance', () => {
  const win = BrowserWindow.getAllWindows().find(window => window.getBounds().width !== 360)
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
})

if (primaryInstance) app.whenReady().then(() => {
  registerPermissions()
  registerIpc()
  const splash = createSplash()
  // Let the small splash paint before loading the main renderer and its modules.
  splash.once('ready-to-show', () => {
    splash.show()
    createWindow(splash)
  })
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  setSleepBlock(false)
  stopSystemAudio()
  app.quit()
})

let preferencesFlushed = false
app.on('before-quit', event => {
  if (preferencesFlushed) return
  event.preventDefault()
  void flushParticipantPreferences().finally(() => { preferencesFlushed = true; app.quit() })
})
