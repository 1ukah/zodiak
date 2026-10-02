const { contextBridge } = require('electron')
let config = { url: 'ws://localhost:7880', apiKey: 'test', apiSecret: 'test', displayName: 'Alex Morgan', showStreamStatistics: false, checkForUpdatesOnStartup: true, voiceEnabled: true, voiceInputDeviceId: 'default', voiceInputVolume: 1, chatPosition: 'bottom' }
let rooms = [{ name: 'the-lounge', participants: 3, sharing: false }, { name: 'watch-party', participants: 2, sharing: true }, { name: 'after-hours', participants: 0, sharing: false }]
let serverAvailable = true
const ok = value => Promise.resolve({ ok: true, value })
contextBridge.exposeInMainWorld('sharescreen', {
  rendererReady() {}, getConfig: () => Promise.resolve(config),
  saveConfig: next => { config = next; return ok(config) },
  listRooms: () => serverAvailable ? ok(rooms) : Promise.resolve({ ok: false, error: 'Server unavailable' }), setTestServerAvailable: value => { serverAvailable = Boolean(value) }, createRoom: ({ name }) => { const room = { name, participants: 0, sharing: false }; rooms.push(room); return ok(room) },
  listRoomParticipants: () => ok([{ id: 'me', name: config.displayName }, { id: 'sam', name: 'Sam Rivera' }, { id: 'jo', name: 'Jordan Lee' }]),
  deleteRoom: ({ name }) => { rooms = rooms.filter(r => r.name !== name); return ok(true) },
  createToken: ({ room }) => ok({ url: config.url, token: 'ui-test', identity: 'me', room, role: 'viewer' }),
  listSources: () => ok([{ id: 'screen:1', name: 'Entire screen', thumbnail: '' }, { id: 'window:1', name: 'Browser window', thumbnail: '' }]),
  prepareShare: () => ok(true), getCaptureAcceleration: () => Promise.resolve({ ready: true, videoEncode: 'enabled', videoDecode: 'enabled', compositing: 'enabled' }), setSharing: () => ok(true), startSystemAudio: () => ok(true), stopSystemAudio: () => ok(true), onSystemAudio: () => () => {},
  setWindowFullscreen: active => ok(Boolean(active)), onWindowFullscreenChanged: () => () => {},
})
