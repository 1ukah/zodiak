import { contextBridge, ipcRenderer } from 'electron'
import { channels, type SharescreenApi } from '../shared/types'

const api = {
  rendererReady: () => ipcRenderer.send(channels.rendererReady),
  getConfig: () => ipcRenderer.invoke(channels.getConfig),
  saveConfig: (config) => ipcRenderer.invoke(channels.saveConfig, config),
  checkForUpdates: (channel) => ipcRenderer.invoke(channels.checkForUpdates, channel),
  createToken: (request) => ipcRenderer.invoke(channels.createToken, request),
  listRooms: () => ipcRenderer.invoke(channels.listRooms),
  listRoomParticipants: (request) => ipcRenderer.invoke(channels.listRoomParticipants, request),
  createRoom: (request) => ipcRenderer.invoke(channels.createRoom, request),
  deleteRoom: (request) => ipcRenderer.invoke(channels.deleteRoom, request),
  listSources: () => ipcRenderer.invoke(channels.listSources),
  prepareShare: (request) => ipcRenderer.invoke(channels.prepareShare, request),
  getCaptureAcceleration: () => ipcRenderer.invoke(channels.getCaptureAcceleration),
  setSharing: (active) => ipcRenderer.invoke(channels.setSharing, active),
  startSystemAudio: (excludeDiscord) => ipcRenderer.invoke(channels.startSystemAudio, excludeDiscord),
  stopSystemAudio: () => ipcRenderer.invoke(channels.stopSystemAudio),
  onSystemAudio: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
      if (payload instanceof Uint8Array) listener(payload)
    }
    ipcRenderer.on(channels.systemAudioData, wrapped)
    return () => ipcRenderer.removeListener(channels.systemAudioData, wrapped)
  },
  setWindowFullscreen: (active) => ipcRenderer.invoke(channels.setWindowFullscreen, active),
  onWindowFullscreenChanged: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, active: unknown): void => {
      if (typeof active === 'boolean') listener(active)
    }
    ipcRenderer.on(channels.windowFullscreenChanged, wrapped)
    return () => ipcRenderer.removeListener(channels.windowFullscreenChanged, wrapped)
  },
} satisfies SharescreenApi

contextBridge.exposeInMainWorld('sharescreen', api)
