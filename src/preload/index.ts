import { contextBridge, ipcRenderer } from 'electron'
import { channels, type SharescreenApi } from '../shared/types'

const api = {
  rendererReady: () => ipcRenderer.send(channels.rendererReady),
  getConfig: () => ipcRenderer.invoke(channels.getConfig),
  saveConfig: (config) => ipcRenderer.invoke(channels.saveConfig, config),
  createToken: (request) => ipcRenderer.invoke(channels.createToken, request),
  listRooms: () => ipcRenderer.invoke(channels.listRooms),
  createRoom: (request) => ipcRenderer.invoke(channels.createRoom, request),
  deleteRoom: (request) => ipcRenderer.invoke(channels.deleteRoom, request),
  listSources: () => ipcRenderer.invoke(channels.listSources),
  prepareShare: (request) => ipcRenderer.invoke(channels.prepareShare, request),
  setSharing: (active) => ipcRenderer.invoke(channels.setSharing, active),
  startSystemAudio: () => ipcRenderer.invoke(channels.startSystemAudio),
  stopSystemAudio: () => ipcRenderer.invoke(channels.stopSystemAudio),
  onSystemAudio: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
      if (payload instanceof Uint8Array) listener(payload)
    }
    ipcRenderer.on(channels.systemAudioData, wrapped)
    return () => ipcRenderer.removeListener(channels.systemAudioData, wrapped)
  },
} satisfies SharescreenApi

contextBridge.exposeInMainWorld('sharescreen', api)
