import { app, BrowserWindow, ipcMain, nativeImage, powerSaveBlocker, session } from 'electron'
import { join } from 'node:path'
import { channels, type ShareRequest } from '../shared/types'
import { armCapture, listSources, registerCaptureHandler } from './capture'
import { loadConfig, saveConfig } from './config'
import { isRecord } from './parse'
import { settle } from './result'
import { createLiveRoom, deleteLiveRoom, listLiveRooms } from './rooms'
import { startSystemAudio, stopSystemAudio } from './system-audio'
import { createParticipantToken } from './tokens'

let sleepBlocker: number | null = null

function blankIcon() {
  const size = 16
  return nativeImage.createFromBitmap(Buffer.alloc(size * size * 4), { width: size, height: size })
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 920,
    minHeight: 640,
    show: false,
    backgroundColor: '#0f1113',
    autoHideMenuBar: true,
    title: 'Welfare Office',
    icon: blankIcon(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  })

  win.on('page-title-updated', (event) => {
    event.preventDefault()
  })

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env.ELECTRON_RENDERER_URL
    if (devUrl && url.startsWith(devUrl)) return
    event.preventDefault()
  })

  win.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error(preloadPath, error)
  })

  win.once('ready-to-show', () => {
    win.show()
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

function parseShareRequest(value: unknown): ShareRequest {
  if (!isRecord(value)) throw new Error('Choose a screen or window')
  if (typeof value.sourceId !== 'string' || value.sourceId.length === 0 || value.sourceId.length > 512) {
    throw new Error('Choose a screen or window')
  }
  if (typeof value.withAudio !== 'boolean') throw new Error('Invalid audio option')
  return { sourceId: value.sourceId, withAudio: value.withAudio }
}

function registerIpc(): void {
  ipcMain.handle(channels.getConfig, () => loadConfig())
  ipcMain.handle(channels.saveConfig, (_event, payload: unknown) => settle(() => saveConfig(payload)))
  ipcMain.handle(channels.createToken, (_event, payload: unknown) => settle(() => createParticipantToken(payload)))
  ipcMain.handle(channels.listRooms, () => settle(() => listLiveRooms()))
  ipcMain.handle(channels.createRoom, (_event, payload: unknown) => settle(() => createLiveRoom(payload)))
  ipcMain.handle(channels.deleteRoom, (_event, payload: unknown) => settle(() => deleteLiveRoom(payload)))
  ipcMain.handle(channels.listSources, () => settle(() => listSources()))
  ipcMain.handle(channels.prepareShare, (_event, payload: unknown) =>
    settle(async () => {
      armCapture(parseShareRequest(payload))
      return true as const
    }),
  )
  ipcMain.handle(channels.setSharing, (_event, payload: unknown) =>
    settle(async () => {
      if (typeof payload !== 'boolean') throw new Error('Invalid share state')
      setSleepBlock(payload)
      if (!payload) stopSystemAudio()
      return true as const
    }),
  )
  ipcMain.handle(channels.startSystemAudio, (event) => settle(() => startSystemAudio(event.sender)))
  ipcMain.handle(channels.stopSystemAudio, () =>
    settle(async () => {
      stopSystemAudio()
      return true as const
    }),
  )
}

function registerPermissions(): void {
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(permission === 'media' || permission === 'display-capture')
  })
  registerCaptureHandler()
}

app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId('sharescreen')
  registerPermissions()
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  stopSystemAudio()
  setSleepBlock(false)
  app.quit()
})
