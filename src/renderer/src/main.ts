import type { AppConfig, DesktopSourceInfo, Role, RoomSummary } from '../../shared/types'
import { joinRoom, leaveRoom, publishScreen, unpublishScreen, type Presence, type SessionHooks } from './session'

const createForm = byId('create-form', HTMLFormElement)
const newRoomInput = byId('new-room', HTMLInputElement)
const createButton = byId('create-room', HTMLButtonElement)
const listNote = byId('list-note', HTMLParagraphElement)
const roomList = elementById('room-list')
const nameInput = byId('display-name', HTMLInputElement)
const serverDetails = byId('server-details', HTMLDetailsElement)
const urlInput = byId('server-url', HTMLInputElement)
const keyInput = byId('api-key', HTMLInputElement)
const secretInput = byId('api-secret', HTMLInputElement)
const roomTitle = byId('room-title', HTMLHeadingElement)
const sessionMeta = byId('session-meta', HTMLParagraphElement)
const presence = byId('presence', HTMLParagraphElement)
const presenceLabel = byId('presence-label', HTMLSpanElement)
const hearButton = byId('hear-audio', HTMLButtonElement)
const shareButton = byId('share', HTMLButtonElement)
const stopButton = byId('stop-live', HTMLButtonElement)
const leaveButton = byId('leave', HTMLButtonElement)
const stage = elementById('stage')
const video = byId('stage-video', HTMLVideoElement)
const audio = byId('remote-audio', HTMLAudioElement)
const waiting = elementById('waiting')
const waitingTitle = byId('waiting-title', HTMLParagraphElement)
const waitingCopy = byId('waiting-copy', HTMLParagraphElement)
const stageNote = byId('stage-note', HTMLParagraphElement)
const picker = elementById('picker')
const pickerForm = byId('picker-form', HTMLFormElement)
const refreshButton = byId('refresh-sources', HTMLButtonElement)
const sourcesEl = elementById('sources')
const audioInput = byId('system-audio', HTMLInputElement)
const pickerNote = byId('picker-note', HTMLParagraphElement)
const goLiveButton = byId('go-live', HTMLButtonElement)
const cancelShareButton = byId('cancel-share', HTMLButtonElement)

let rooms: RoomSummary[] = []
let currentRoom: string | null = null
let selectedSourceId: string | null = null
let sharing = false
let connection: Presence = 'offline'
let remoteVideo = false
let remoteName = ''
let viewerCount = 0
let listing = false

const hooks: SessionHooks = {
  onConnection: (state) => {
    connection = state
    renderChrome()
  },
  onViewers: (count) => {
    viewerCount = count
    renderChrome()
  },
  onRemoteVideo: (active, participantName) => {
    remoteVideo = active
    remoteName = participantName
    renderChrome()
  },
  onLocalVideo: (active) => {
    sharing = active
    renderChrome()
  },
  onAudioBlocked: (blocked) => {
    hearButton.hidden = !blocked
  },
  onError: (message) => {
    showNote(stageNote, message, 'error')
  },
}

void boot()

async function boot(): Promise<void> {
  if (!window.sharescreen) {
    showNote(listNote, 'The app failed to start. Reopen the window.', 'error')
    return
  }
  const config = await window.sharescreen.getConfig()
  fillForm(config)
  if (!config.apiKey || !config.apiSecret) serverDetails.open = true
  bind()
  await refreshRooms()
  window.setInterval(() => {
    void refreshRooms()
  }, 3000)
}

function bind(): void {
  createForm.addEventListener('submit', (event) => {
    event.preventDefault()
    void onCreateRoom()
  })
  nameInput.addEventListener('change', () => {
    void persistConfig()
  })
  for (const input of [urlInput, keyInput, secretInput]) {
    input.addEventListener('change', () => {
      void persistConfig().then(() => refreshRooms())
    })
  }
  shareButton.addEventListener('click', () => {
    void openPicker()
  })
  stopButton.addEventListener('click', () => {
    void onStop()
  })
  leaveButton.addEventListener('click', () => {
    void onLeave()
  })
  hearButton.addEventListener('click', () => {
    void audio.play().then(() => {
      hearButton.hidden = true
    })
  })
  refreshButton.addEventListener('click', () => {
    void loadSources()
  })
  pickerForm.addEventListener('submit', (event) => {
    event.preventDefault()
    void onGoLive()
  })
  cancelShareButton.addEventListener('click', () => {
    closePicker()
  })
  window.addEventListener('beforeunload', () => {
    void window.sharescreen.setSharing(false)
    void leaveRoom()
  })
}

async function refreshRooms(): Promise<void> {
  if (listing) return
  listing = true
  try {
    const listed = await window.sharescreen.listRooms()
    if (!listed.ok) {
      showNote(listNote, listed.error, 'error')
      if (/API key|API secret|Server URL/i.test(listed.error)) serverDetails.open = true
      return
    }
    rooms = listed.value
    clearNote(listNote)
    renderRooms()
    renderChrome()
  } finally {
    listing = false
  }
}

function renderRooms(): void {
  roomList.replaceChildren()
  if (rooms.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'muted'
    empty.textContent = 'No rooms yet. Create one to get started.'
    roomList.append(empty)
    return
  }
  for (const room of rooms) {
    const row = document.createElement('div')
    row.className = 'room-row'
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'room'
    if (room.name === currentRoom) button.classList.add('is-active')
    button.setAttribute('aria-pressed', room.name === currentRoom ? 'true' : 'false')
    const hash = document.createElement('span')
    hash.textContent = '#'
    const label = document.createElement('span')
    label.className = 'room-name'
    label.textContent = room.name
    const count = document.createElement('span')
    count.className = 'room-count'
    count.textContent = String(room.participants)
    button.append(hash, label)
    if (room.sharing) {
      const dot = document.createElement('i')
      dot.className = 'live-dot'
      button.append(dot)
    }
    button.append(count)
    button.addEventListener('click', () => {
      void onJoin(room.name)
    })
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'room-delete'
    remove.textContent = '×'
    remove.setAttribute('aria-label', `Delete ${room.name}`)
    remove.addEventListener('click', () => {
      void onDelete(room.name)
    })
    row.append(button, remove)
    roomList.append(row)
  }
}

async function onCreateRoom(): Promise<void> {
  const name = newRoomInput.value.trim()
  if (!requireName()) return
  if (!name) {
    showNote(listNote, 'Enter a room name', 'error')
    return
  }
  createButton.disabled = true
  try {
    const saved = await persistConfig()
    if (!saved) return
    const created = await window.sharescreen.createRoom({ name, displayName: saved.displayName })
    if (!created.ok) {
      showNote(listNote, created.error, 'error')
      return
    }
    newRoomInput.value = ''
    clearNote(listNote)
    await refreshRooms()
    await connect(created.value.name, 'viewer')
  } finally {
    createButton.disabled = false
  }
}

async function onJoin(name: string): Promise<void> {
  if (currentRoom === name && connection === 'connected') return
  if (!requireName()) return
  await connect(name, 'viewer')
}

async function onDelete(name: string): Promise<void> {
  if (!window.confirm(`Delete #${name}? Everyone will lose this room.`)) return
  if (currentRoom === name) await onLeave()
  const removed = await window.sharescreen.deleteRoom({ name })
  if (!removed.ok) {
    showNote(listNote, removed.error, 'error')
    return
  }
  await refreshRooms()
}

async function connect(roomName: string, role: Role): Promise<boolean> {
  const saved = await persistConfig()
  if (!saved) return false
  const issued = await window.sharescreen.createToken({
    role,
    displayName: saved.displayName,
    room: roomName,
  })
  if (!issued.ok) {
    showNote(picker.hidden ? stageNote : pickerNote, issued.error, 'error')
    return false
  }
  try {
    await joinRoom({
      url: issued.value.url,
      token: issued.value.token,
      subscribe: true,
      media: { video, audio },
      hooks,
    })
  } catch (error) {
    currentRoom = null
    sharing = false
    remoteVideo = false
    remoteName = ''
    connection = 'offline'
    showNote(picker.hidden ? stageNote : pickerNote, messageOf(error), 'error')
    renderChrome()
    return false
  }
  currentRoom = roomName
  clearNote(stageNote)
  renderRooms()
  renderChrome()
  void refreshRooms()
  return true
}

async function openPicker(): Promise<void> {
  if (!currentRoom || sharing || remoteVideo) return
  picker.hidden = false
  clearNote(pickerNote)
  await loadSources()
}

function closePicker(): void {
  picker.hidden = true
  selectedSourceId = null
  clearNote(pickerNote)
  updatePickerControls()
}

async function loadSources(): Promise<void> {
  const listed = await window.sharescreen.listSources()
  if (!listed.ok) {
    showNote(pickerNote, listed.error, 'error')
    return
  }
  if (selectedSourceId && !listed.value.some((source) => source.id === selectedSourceId)) {
    selectedSourceId = null
  }
  renderSources(listed.value)
  updatePickerControls()
}

function renderSources(sources: DesktopSourceInfo[]): void {
  sourcesEl.replaceChildren()
  if (sources.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'muted'
    empty.textContent = 'No screens found.'
    sourcesEl.append(empty)
    return
  }
  for (const source of sources) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'source'
    if (source.id === selectedSourceId) button.classList.add('is-selected')
    button.dataset.id = source.id
    button.setAttribute('aria-pressed', source.id === selectedSourceId ? 'true' : 'false')
    const img = document.createElement('img')
    img.alt = ''
    if (source.thumbnail) img.src = source.thumbnail
    else img.classList.add('is-empty')
    const label = document.createElement('span')
    label.textContent = source.name
    button.append(img, label)
    button.addEventListener('click', () => {
      selectSource(source.id)
    })
    sourcesEl.append(button)
  }
}

function selectSource(id: string): void {
  selectedSourceId = id
  sourcesEl.querySelectorAll('button.source').forEach((node) => {
    if (!(node instanceof HTMLButtonElement)) return
    const on = node.dataset.id === id
    node.classList.toggle('is-selected', on)
    node.setAttribute('aria-pressed', on ? 'true' : 'false')
  })
  updatePickerControls()
}

async function onGoLive(): Promise<void> {
  if (!currentRoom || !selectedSourceId) {
    showNote(pickerNote, 'Choose a screen or window.', 'error')
    return
  }
  const roomName = currentRoom
  const sourceId = selectedSourceId
  const withAudio = audioInput.checked
  goLiveButton.disabled = true
  try {
    const joined = await connect(roomName, 'publisher')
    if (!joined) return
    let live = await startShare(sourceId, withAudio)
    if (!live && withAudio) {
      live = await startShare(sourceId, false)
      if (live) {
        audioInput.checked = false
        showNote(stageNote, 'System audio is unavailable. Sharing video only.', 'warn')
      }
    }
    if (!live) {
      await connect(roomName, 'viewer')
      return
    }
    const active = await window.sharescreen.setSharing(true)
    if (!active.ok) showNote(stageNote, active.error, 'warn')
    closePicker()
    renderChrome()
  } finally {
    goLiveButton.disabled = false
    updatePickerControls()
  }
}

async function startShare(sourceId: string, withAudio: boolean): Promise<boolean> {
  const armed = await window.sharescreen.prepareShare({ sourceId, withAudio })
  if (!armed.ok) {
    showNote(pickerNote, armed.error, 'error')
    return false
  }
  try {
    await publishScreen(withAudio)
    return true
  } catch (error) {
    if (!withAudio) showNote(pickerNote, messageOf(error), 'error')
    return false
  }
}

async function onStop(): Promise<void> {
  const roomName = currentRoom
  stopButton.disabled = true
  try {
    await unpublishScreen()
    await window.sharescreen.setSharing(false)
    sharing = false
    if (roomName) await connect(roomName, 'viewer')
  } catch (error) {
    showNote(stageNote, messageOf(error), 'error')
  } finally {
    stopButton.disabled = false
    renderChrome()
  }
}

async function onLeave(): Promise<void> {
  leaveButton.disabled = true
  try {
    await window.sharescreen.setSharing(false)
    await leaveRoom()
  } finally {
    currentRoom = null
    sharing = false
    remoteVideo = false
    remoteName = ''
    viewerCount = 0
    connection = 'offline'
    hearButton.hidden = true
    closePicker()
    clearNote(stageNote)
    leaveButton.disabled = false
    renderChrome()
    void refreshRooms()
  }
}

function renderChrome(): void {
  const inRoom = currentRoom !== null
  roomTitle.textContent = inRoom ? `# ${currentRoom}` : 'Select a room'
  stage.classList.toggle('is-idle', !inRoom)
  shareButton.hidden = !inRoom || sharing
  stopButton.hidden = !sharing
  leaveButton.hidden = !inRoom
  shareButton.disabled = remoteVideo
  shareButton.textContent = remoteVideo ? 'Screen in use' : 'Share screen'
  if (!inRoom) {
    waiting.hidden = false
    waitingTitle.textContent = 'Rooms'
    waitingCopy.textContent = 'Create a room or join one from the list. Everyone sees the same rooms.'
    sessionMeta.textContent = ''
    setPresence('offline', 'Offline')
    renderRooms()
    return
  }
  const people = connection === 'connected' ? viewerCount + 1 : viewerCount
  const noun = people === 1 ? 'person' : 'people'
  if (sharing) sessionMeta.textContent = `${people} ${noun} · You are sharing`
  else if (remoteName) sessionMeta.textContent = `${people} ${noun} · ${remoteName} is sharing`
  else sessionMeta.textContent = `${people} ${noun}`
  const showVideo = sharing || remoteVideo
  waiting.hidden = showVideo
  if (!showVideo) {
    waitingTitle.textContent = 'No one is sharing'
    waitingCopy.textContent = 'The screen will show up here when someone shares in this room.'
  }
  if (connection === 'reconnecting') setPresence('reconnecting', 'Reconnecting')
  else if (connection === 'connecting') setPresence('connecting', 'Connecting')
  else if (connection !== 'connected') setPresence('offline', 'Offline')
  else if (sharing) setPresence('live', 'Live')
  else if (remoteVideo) setPresence('connected', 'Watching')
  else setPresence('connected', 'In room')
}

function setPresence(kind: Presence | 'live', label: string): void {
  presence.className = kind
  presenceLabel.textContent = label
}

function updatePickerControls(): void {
  goLiveButton.disabled = selectedSourceId === null
}

function requireName(): boolean {
  if (nameInput.value.trim()) return true
  showNote(listNote, 'Enter your display name', 'error')
  nameInput.focus()
  return false
}

async function persistConfig(): Promise<AppConfig | null> {
  const saved = await window.sharescreen.saveConfig(readForm())
  if (!saved.ok) {
    showNote(listNote, saved.error, 'error')
    if (/API key|API secret|Server URL/i.test(saved.error)) serverDetails.open = true
    return null
  }
  fillForm(saved.value)
  return saved.value
}

function readForm(): AppConfig {
  return {
    url: urlInput.value,
    apiKey: keyInput.value,
    apiSecret: secretInput.value,
    displayName: nameInput.value,
  }
}

function fillForm(config: AppConfig): void {
  urlInput.value = config.url
  keyInput.value = config.apiKey
  secretInput.value = config.apiSecret
  nameInput.value = config.displayName
}

function showNote(note: HTMLParagraphElement, message: string, tone: 'error' | 'warn'): void {
  note.hidden = false
  note.dataset.tone = tone
  note.textContent = message
}

function clearNote(note: HTMLParagraphElement): void {
  note.hidden = true
  note.textContent = ''
  delete note.dataset.tone
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return 'Something went wrong'
}

function byId<T extends HTMLElement>(id: string, ctor: new () => T): T {
  const found = document.getElementById(id)
  if (!(found instanceof ctor)) throw new Error(`Missing #${id}`)
  return found
}

function elementById(id: string): HTMLElement {
  const found = document.getElementById(id)
  if (!(found instanceof HTMLElement)) throw new Error(`Missing #${id}`)
  return found
}
