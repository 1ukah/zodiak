import { shareBitrateRangeFor, type AppConfig, type DesktopSourceInfo, type Role, type RoomSummary, type ShareBitrateMode, type ShareFrameRate, type ShareQuality, type ShareResolution } from '../../shared/types'
import { joinRoom, leaveRoom, publishScreen, selectStream, setGridVideos, setRemoteAudioOutputDevice, setRemoteAudioVolume, setStageVideoVisible, setStreamMuted, setStreamVolume, supportsRemoteAudioOutputSelection, unpublishScreen, updateDisplayName, type Presence, type RoomParticipant, type ScreenStream, type SessionHooks, type StreamMetric, type StreamTelemetry } from './session'
import { hydrateIcons, icon, labelButton } from './icons'

hydrateIcons()

const createForm = byId('create-form', HTMLFormElement)
const newRoomInput = byId('new-room', HTMLInputElement)
const createButton = byId('create-room', HTMLButtonElement)
const listNote = byId('list-note', HTMLParagraphElement)
const roomList = elementById('room-list')
const workspaceRail = document.querySelector<HTMLElement>('.workspace-rail')!
const createRoomAction = byId('create-room-action', HTMLButtonElement)
const nameInput = byId('display-name', HTMLInputElement)
const urlInput = byId('server-url', HTMLInputElement)
const keyInput = byId('api-key', HTMLInputElement)
const secretInput = byId('api-secret', HTMLInputElement)
const roomTitle = byId('room-title', HTMLHeadingElement)
const hearButton = byId('hear-audio', HTMLButtonElement)
const fullscreenButton = byId('fullscreen', HTMLButtonElement)
const popOutButton = byId('pop-out', HTMLButtonElement)
const gridViewButton = byId('grid-view', HTMLButtonElement)
const theaterButton = byId('theater', HTMLButtonElement)
const shareButton = byId('share', HTMLButtonElement)
const hideMyScreenButton = byId('hide-my-screen', HTMLButtonElement)
const stopButton = byId('stop-live', HTMLButtonElement)
const leaveButton = byId('leave', HTMLButtonElement)
const stage = elementById('stage')
const stageWrap = elementById('stage-wrap')
const video = byId('stage-video', HTMLVideoElement)
const streamGrid = elementById('stream-grid')
const focusedStreamVolume = byId('focused-stream-volume', HTMLDivElement)
const focusedStreamVolumeInput = byId('focused-stream-volume-input', HTMLInputElement)
const focusedStreamVolumeValue = byId('focused-stream-volume-value', HTMLOutputElement)
const focusedStreamMuteButton = byId('focused-stream-mute', HTMLButtonElement)
const audioRack = elementById('remote-audio-rack')
const waiting = elementById('waiting')
const waitingMessage = byId('waiting-message', HTMLParagraphElement)
const stageNote = byId('stage-note', HTMLParagraphElement)
const streamMetrics = elementById('stream-metrics')
const hostMetrics = byId('host-metrics', HTMLElement)
const viewerMetrics = byId('viewer-metrics', HTMLElement)
const membersPanel = elementById('members-panel')
const membersCount = byId('members-count', HTMLSpanElement)
const membersList = elementById('members-list')
const picker = byId('picker', HTMLDialogElement)
const pickerForm = byId('picker-form', HTMLFormElement)
const refreshButton = byId('refresh-sources', HTMLButtonElement)
const sourcesEl = elementById('sources')
const audioInput = byId('system-audio', HTMLInputElement)
const blockDiscordInput = byId('block-discord-audio', HTMLInputElement)
const resolutionInput = byId('share-resolution', HTMLSelectElement)
const frameRateInput = byId('share-framerate', HTMLSelectElement)
const bitrateModeInput = byId('share-bitrate-mode', HTMLSelectElement)
const fixedBitrateField = byId('fixed-bitrate-field', HTMLLabelElement)
const bitrateInput = byId('share-bitrate', HTMLInputElement)
const bitrateValue = byId('share-bitrate-value', HTMLOutputElement)
const pickerNote = byId('picker-note', HTMLParagraphElement)
const goLiveButton = byId('go-live', HTMLButtonElement)
const cancelShareButton = byId('cancel-share', HTMLButtonElement)
const audioOutputInput = byId('audio-output', HTMLSelectElement)
const refreshAudioOutputButton = byId('refresh-audio-output', HTMLButtonElement)
const audioVolumeInput = byId('audio-volume', HTMLInputElement)
const audioVolumeValue = byId('audio-volume-value', HTMLOutputElement)
const audioOutputNote = byId('audio-output-note', HTMLParagraphElement)
const showStreamStatisticsInput = byId('show-stream-statistics', HTMLInputElement)
const settingsDialog = byId('settings-dialog', HTMLDialogElement)
const serverDialog = byId('server-dialog', HTMLDialogElement)
const deleteDialog = byId('delete-dialog', HTMLDialogElement)
const createDialog = byId('create-dialog', HTMLDialogElement)
const settingsNote = byId('settings-note', HTMLParagraphElement)
const serverNote = byId('server-note', HTMLParagraphElement)
const deleteNote = byId('delete-note', HTMLParagraphElement)
const deleteMessage = byId('delete-message', HTMLParagraphElement)
const createNote = byId('create-note', HTMLParagraphElement)
const roomSidebar = byId('room-sidebar', HTMLElement)
const participantGrid = elementById('participant-grid')
let savedConfig: AppConfig | null = null
let joining = false
let publishing = false
let sourcesRequest = 0
let showStatistics = false

let rooms: RoomSummary[] = []
let currentRoom: string | null = null
let selectedSourceId: string | null = null
let connection: Presence = 'offline'
let streams: ScreenStream[] = []
let participants: RoomParticipant[] = []
let selectedStreamId: string | null = null
let hideLocalPreview = false
let gridView = false
let listing = false
let serverUnavailable = false
let telemetry: StreamTelemetry = {}
let lastGridSignature = ''
let roomsFingerprint = ''
let selectedAudioOutput = 'default'
let windowFullscreen = false
let screenControlsVisible = false
let screenControlsTimer: number | null = null
let streamMetricsHovered = false
const streamVolumes = new Map<string, number>()
let roomPendingDeletion: string | null = null

const hooks: SessionHooks = {
  onConnection: (state) => {
    connection = state
    renderChrome()
  },
  onViewers: () => renderChrome(),
  onParticipants: (next) => {
    participants = next
    renderMembers()
    renderChrome()
  },
  onStreams: (next) => {
    if (next.length > 1 || (next.length > 0 && streams.length === 0 && participants.length > 1)) gridView = true
    streams = next
    for (const id of streamVolumes.keys()) if (!next.some((stream) => stream.id === id)) streamVolumes.delete(id)
    if (selectedStreamId && !streams.some((stream) => stream.id === selectedStreamId)) selectedStreamId = null
    if (!selectedStreamId) selectBestStream()
    renderChrome()
  },
  onTelemetry: (next) => {
    telemetry = next
    renderTelemetry()
  },
  onAudioBlocked: (blocked) => {
    hearButton.hidden = !blocked
  },
  onError: (message) => showNote(stageNote, message, 'error'),
}

void boot().catch((error) => {
  showNote(listNote, `Could not start: ${messageOf(error)}`, 'error')
  window.sharescreen?.rendererReady()
})

async function boot(): Promise<void> {
  if (!window.sharescreen) {
    serverUnavailable = true
    renderRooms()
    renderChrome()
    return
  }
  fillForm(await window.sharescreen.getConfig())
  bind()
  syncSystemAudioControls()
  syncAudioControls()
  renderChrome()
  window.sharescreen.rendererReady()
  void loadAudioOutputs()
  void refreshRooms()
  // Room events keep an open room current instantly. The lobby poll is only a
  // fallback for other rooms and deliberately does not rebuild the video UI
  // when the response is unchanged.
  window.setInterval(() => void refreshRooms(), 5_000)
}

function bind(): void {
  createForm.addEventListener('submit', (event) => { event.preventDefault(); void onCreateRoom() })
  document.querySelectorAll<HTMLButtonElement>('[data-create-room]').forEach((button) => button.addEventListener('click', () => {
    clearNote(createNote)
    createDialog.showModal()
    newRoomInput.focus()
  }))
  document.querySelectorAll<HTMLButtonElement>('[data-settings]').forEach((button) => button.addEventListener('click', () => openSettings()))
  elementById('server-settings').addEventListener('click', openServerSettings)
  document.querySelectorAll<HTMLButtonElement>('[data-close]').forEach((button) => button.addEventListener('click', () => byId(button.dataset.close!, HTMLDialogElement).close()))
  settingsDialog.addEventListener('close', () => { if (savedConfig) fillForm(savedConfig) })
  serverDialog.addEventListener('close', () => { if (savedConfig) fillForm(savedConfig) })
  deleteDialog.addEventListener('close', () => { roomPendingDeletion = null; clearNote(deleteNote) })
  byId('save-settings', HTMLButtonElement).addEventListener('click', async () => {
    const button = byId('save-settings', HTMLButtonElement)
    button.disabled = true
    try {
      const previousName = savedConfig?.displayName
      const saved = await persistConfig()
      if (!saved) return
      if (currentRoom && saved.displayName !== previousName) {
        try {
          await updateDisplayName(saved.displayName)
        } catch (error) {
          showNote(settingsNote, `Saved for future rooms, but could not update this room: ${messageOf(error)}`, 'error')
          return
        }
      }
      settingsDialog.close()
      void refreshRooms()
    }
    finally { button.disabled = false }
  })
  byId('save-server-settings', HTMLButtonElement).addEventListener('click', async () => {
    const button = byId('save-server-settings', HTMLButtonElement)
    button.disabled = true
    try { if (await persistConfig()) { serverDialog.close(); void refreshRooms() } }
    finally { button.disabled = false }
  })
  byId('confirm-delete-room', HTMLButtonElement).addEventListener('click', () => {
    const name = roomPendingDeletion
    if (name) void onDelete(name)
  })
  elementById('exit-focus').addEventListener('click', () => void exitFocusView())
  picker.addEventListener('cancel', (event) => { event.preventDefault(); if (!publishing) closePicker() })
  shareButton.addEventListener('click', () => void openPicker())
  fullscreenButton.addEventListener('click', () => void toggleFullscreen())
  popOutButton.addEventListener('click', () => void popOutVideo())
  gridViewButton.addEventListener('click', () => {
    gridView = !gridView
    renderChrome()
  })
  theaterButton.addEventListener('click', () => {
    setTheater(!document.body.classList.contains('theater'))
  })
  hideMyScreenButton.addEventListener('click', () => {
    hideLocalPreview = !hideLocalPreview
    selectBestStream()
    renderChrome()
  })
  stageWrap.addEventListener('pointermove', revealScreenControls)
  stageWrap.addEventListener('pointerdown', revealScreenControls)
  stageWrap.addEventListener('focusin', revealScreenControls)
  streamMetrics.addEventListener('pointerenter', () => {
    streamMetricsHovered = true
    revealScreenControls()
  })
  streamMetrics.addEventListener('pointerleave', () => {
    streamMetricsHovered = false
    revealScreenControls()
  })
  video.addEventListener('click', () => {
    if (streams.length && participants.length > 1) { gridView = true; renderChrome() }
  })
  focusedStreamVolumeInput.addEventListener('input', syncFocusedStreamVolume)
  focusedStreamMuteButton.addEventListener('click', () => {
    const stream = streams.find((candidate) => candidate.id === selectedStreamId)
    if (!stream || stream.local) return
    setStreamMuted(stream.id, !stream.muted)
    revealScreenControls()
  })
  stopButton.addEventListener('click', () => void onStop())
  leaveButton.addEventListener('click', () => void onLeave())
  hearButton.addEventListener('click', () => {
    const plays = [...audioRack.querySelectorAll('audio')].map((audio) => audio.play())
    void Promise.allSettled(plays).then(() => { hearButton.hidden = true })
  })
  refreshButton.addEventListener('click', () => void loadSources())
  audioInput.addEventListener('change', syncSystemAudioControls)
  audioVolumeInput.addEventListener('input', syncAudioVolume)
  showStreamStatisticsInput.addEventListener('change', () => {
    showStatistics = showStreamStatisticsInput.checked
    renderTelemetry()
  })
  audioOutputInput.addEventListener('change', () => void onAudioOutputChanged())
  refreshAudioOutputButton.addEventListener('click', () => void loadAudioOutputs())
  navigator.mediaDevices?.addEventListener?.('devicechange', () => void loadAudioOutputs())
  pickerForm.addEventListener('submit', (event) => { event.preventDefault(); void onGoLive() })
  cancelShareButton.addEventListener('click', closePicker)
  resolutionInput.addEventListener('change', syncQualityControls)
  frameRateInput.addEventListener('change', syncQualityControls)
  bitrateModeInput.addEventListener('change', syncQualityControls)
  bitrateInput.addEventListener('input', syncQualityControls)
  window.sharescreen.onWindowFullscreenChanged((active) => {
    windowFullscreen = active
    if (!active) setTheater(false)
    syncFullscreenLabel()
  })
  document.addEventListener('keydown', (event) => {
    if (stageWrap.contains(document.activeElement)) revealScreenControls()
    if (event.key === 'Escape' && document.body.classList.contains('theater')) {
      void exitFocusView()
    }
  })
  window.addEventListener('beforeunload', () => { void window.sharescreen.setSharing(false); void leaveRoom() })
  window.addEventListener('resize', syncRailOverflow)
}

async function refreshRooms(): Promise<void> {
  if (listing) return
  listing = true
  try {
    const listed = await window.sharescreen.listRooms()
    if (!listed.ok) {
      serverUnavailable = true
      rooms = []
      roomsFingerprint = ''
      clearNote(listNote)
      renderRooms()
      renderChrome()
      return
    }
    const fingerprint = JSON.stringify(listed.value)
    const changed = fingerprint !== roomsFingerprint
    roomsFingerprint = fingerprint
    rooms = listed.value
    serverUnavailable = false
    clearNote(listNote)
    if (changed) {
      renderRooms()
      renderChrome()
    }
  } catch (error) {
    serverUnavailable = true
    rooms = []
    roomsFingerprint = ''
    clearNote(listNote)
    renderRooms()
    renderChrome()
  } finally {
    listing = false
  }
}

function renderRooms(): void {
  roomList.replaceChildren()
  createRoomAction.hidden = serverUnavailable
  if (!rooms.length) {
    if (!serverUnavailable) roomList.append(Object.assign(document.createElement('p'), { className: 'muted rail-empty', textContent: '—' }))
    requestAnimationFrame(syncRailOverflow)
    return
  }
  for (const room of rooms) {
    const row = document.createElement('div'); row.className = 'room-row'
    const button = document.createElement('button'); button.type = 'button'; button.className = 'room'
    if (room.name === currentRoom) button.classList.add('is-active')
    button.setAttribute('aria-pressed', String(room.name === currentRoom))
    button.textContent = room.name.slice(0, 1).toUpperCase()
    button.disabled = joining
    button.title = room.name
    button.setAttribute('aria-label', `Join ${room.name}${room.participants ? `, ${room.participants} connected` : ''}`)
    if (room.sharing) button.append(Object.assign(document.createElement('i'), { className: 'live-dot', ariaLabel: 'Screen sharing' }))
    button.addEventListener('click', () => void onJoin(room.name))
    const remove = Object.assign(document.createElement('button'), { type: 'button', className: 'room-delete', textContent: '×', ariaLabel: `Delete ${room.name}` })
    remove.innerHTML = icon('close')
    remove.title = `Delete ${room.name}`
    remove.addEventListener('click', () => requestDelete(room.name))
    row.append(button, remove); roomList.append(row)
  }
  requestAnimationFrame(syncRailOverflow)
}

function syncRailOverflow(): void {
  const buttonsHeight = [...workspaceRail.querySelectorAll<HTMLElement>(':scope > button')]
    .reduce((total, button) => total + button.offsetHeight, 0)
  const styles = getComputedStyle(workspaceRail)
  const gap = Number.parseFloat(styles.gap) || 0
  const available = workspaceRail.clientHeight - buttonsHeight - (gap * 2) - (Number.parseFloat(styles.paddingTop) || 0) - (Number.parseFloat(styles.paddingBottom) || 0)
  workspaceRail.classList.toggle('has-room-overflow', roomList.scrollHeight > available)
}

async function onCreateRoom(): Promise<void> {
  const name = newRoomInput.value.trim()
  if (!requireName()) return
  if (!name) return showNote(createNote, 'Enter a room name', 'error')
  createButton.disabled = true
  try {
    const saved = await persistConfig(); if (!saved) return
    const created = await window.sharescreen.createRoom({ name, displayName: saved.displayName })
    if (!created.ok) return showNote(createNote, created.error, 'error')
    newRoomInput.value = ''; createDialog.close(); await refreshRooms(); await onJoin(created.value.name)
  } catch (error) { showNote(createNote, messageOf(error), 'error')
  } finally { createButton.disabled = false }
}

async function onJoin(name: string): Promise<void> {
  if (joining) return
  if (currentRoom === name && connection === 'connected') return
  if (!requireName()) return
  joining = true; renderRooms()
  try { await connect(name, 'viewer') }
  catch (error) { showNote(stageNote, messageOf(error), 'error') }
  finally { joining = false; renderRooms(); renderChrome() }
}

function requestDelete(name: string): void {
  roomPendingDeletion = name
  clearNote(deleteNote)
  deleteMessage.textContent = `Delete “${name}”? Everyone will lose this room.`
  deleteDialog.showModal()
}

async function onDelete(name: string): Promise<void> {
  const button = byId('confirm-delete-room', HTMLButtonElement)
  button.disabled = true
  try {
    if (currentRoom === name) await onLeave()
    const removed = await window.sharescreen.deleteRoom({ name })
    if (!removed.ok) return showNote(deleteNote, removed.error, 'error')
    deleteDialog.close()
    await refreshRooms()
  } catch (error) { showNote(deleteNote, messageOf(error), 'error')
  } finally { button.disabled = false }
}

async function connect(roomName: string, role: Role): Promise<boolean> {
  const saved = await persistConfig(); if (!saved) return false
  const issued = await window.sharescreen.createToken({ role, displayName: saved.displayName, room: roomName })
  if (!issued.ok) { showNote(picker.open ? pickerNote : stageNote, issued.error, 'error'); return false }
  try {
    await joinRoom({ url: issued.value.url, token: issued.value.token, subscribe: true, media: { video, audioRack }, hooks })
  } catch (error) {
    resetRoomState(); showNote(picker.open ? pickerNote : stageNote, messageOf(error), 'error'); renderChrome(); return false
  }
  currentRoom = roomName; hideLocalPreview = false; clearNote(stageNote); renderRooms(); renderMembers(); renderChrome(); void refreshRooms(); return true
}

async function toggleFullscreen(): Promise<void> {
  try {
    const next = !windowFullscreen
    const result = await window.sharescreen.setWindowFullscreen(next)
    if (!result.ok) throw new Error(result.error)
    windowFullscreen = result.value
    setTheater(windowFullscreen)
    syncFullscreenLabel()
  } catch (error) {
    showNote(stageNote, `Fullscreen is unavailable: ${messageOf(error)}`, 'warn')
  }
}

function syncFullscreenLabel(): void {
  labelButton(fullscreenButton, windowFullscreen ? 'Exit fullscreen' : 'Fullscreen')
}

async function exitFocusView(): Promise<void> {
  if (windowFullscreen) await toggleFullscreen()
  else setTheater(false)
}

async function popOutVideo(): Promise<void> {
  if (!streamGrid.hidden || !selectedStreamId) return showNote(stageNote, 'Choose a single stream before opening picture-in-picture.', 'warn')
  const pipVideo = video as HTMLVideoElement & { requestPictureInPicture?: () => Promise<unknown> }
  if (!pipVideo.requestPictureInPicture) return showNote(stageNote, 'Picture-in-picture is not available in this version.', 'warn')
  try {
    await pipVideo.requestPictureInPicture()
  } catch (error) {
    showNote(stageNote, `Could not open picture-in-picture: ${messageOf(error)}`, 'warn')
  }
}

async function openPicker(): Promise<void> {
  if (!currentRoom) return
  picker.showModal(); clearNote(pickerNote); syncSystemAudioControls(); syncQualityControls(); await loadSources()
}

function closePicker(): void { picker.close(); sourcesRequest++; selectedSourceId = null; clearNote(pickerNote); updatePickerControls() }

async function loadSources(): Promise<void> {
  const request = ++sourcesRequest
  refreshButton.disabled = true
  sourcesEl.setAttribute('aria-busy', 'true')
  sourcesEl.innerHTML = `<span class="source-loading" role="status" aria-label="Loading sources">${icon('loader')}</span>`
  try {
    const listed = await window.sharescreen.listSources()
    if (request !== sourcesRequest || !picker.open) return
    if (!listed.ok) { selectedSourceId = null; sourcesEl.replaceChildren(); showNote(pickerNote, listed.error, 'error'); return }
    if (selectedSourceId && !listed.value.some((source) => source.id === selectedSourceId)) selectedSourceId = null
    renderSources(listed.value)
  } catch (error) { selectedSourceId = null; showNote(pickerNote, messageOf(error), 'error') }
  finally { refreshButton.disabled = false; sourcesEl.setAttribute('aria-busy', 'false'); updatePickerControls() }
}

function renderSources(sources: DesktopSourceInfo[]): void {
  sourcesEl.replaceChildren()
  if (!sources.length) { sourcesEl.append(Object.assign(document.createElement('p'), { className: 'muted', textContent: 'No screens found.' })); return }
  for (const source of sources) {
    const button = Object.assign(document.createElement('button'), { type: 'button', className: 'source' })
    button.title = source.name
    if (source.id === selectedSourceId) button.classList.add('is-selected')
    button.dataset.id = source.id; button.setAttribute('aria-pressed', String(source.id === selectedSourceId))
    const preview = Object.assign(document.createElement('div'), { className: 'source-preview' })
    if (source.thumbnail) preview.append(Object.assign(document.createElement('img'), { alt: '', src: source.thumbnail }))
    else preview.innerHTML = icon('monitor')
    button.append(preview, Object.assign(document.createElement('span'), { textContent: source.name }))
    button.addEventListener('click', () => {
      selectedSourceId = source.id
      for (const option of sourcesEl.querySelectorAll<HTMLButtonElement>('.source')) {
        const selected = option.dataset.id === source.id
        option.classList.toggle('is-selected', selected)
        option.setAttribute('aria-pressed', String(selected))
      }
      updatePickerControls()
    }); sourcesEl.append(button)
  }
}

async function onGoLive(): Promise<void> {
  if (!currentRoom || !selectedSourceId) return showNote(pickerNote, 'Choose a screen or window.', 'error')
  const quality = readQuality(); if (!quality) return
  publishing = true
  setPickerBusy(true)
  let audioGuardArmed = false
  try {
    if (streams.some((stream) => stream.local)) {
      await unpublishScreen()
      await window.sharescreen.setSharing(false)
    }
    const armed = await window.sharescreen.prepareShare({
      sourceId: selectedSourceId,
      withAudio: audioInput.checked,
      blockDiscordAudio: audioInput.checked && blockDiscordInput.checked,
      quality,
    })
    if (!armed.ok) return showNote(pickerNote, armed.error, 'error')
    audioGuardArmed = audioInput.checked
    await publishScreen(audioInput.checked, audioInput.checked && blockDiscordInput.checked, quality)
    const active = await window.sharescreen.setSharing(true)
    if (!active.ok) showNote(stageNote, active.error, 'warn')
    closePicker(); renderChrome(); void refreshRooms()
  } catch (error) { showNote(pickerNote, messageOf(error), 'error')
    if (audioGuardArmed) await window.sharescreen.setSharing(false)
  } finally { publishing = false; setPickerBusy(false); updatePickerControls() }
}

async function onStop(): Promise<void> {
  stopButton.disabled = true
  try { await unpublishScreen(); await window.sharescreen.setSharing(false); hideLocalPreview = false; void refreshRooms()
  } catch (error) { showNote(stageNote, messageOf(error), 'error')
  } finally { stopButton.disabled = false; renderChrome() }
}

async function onLeave(): Promise<void> {
  leaveButton.disabled = true
  try { await window.sharescreen.setSharing(false); await leaveRoom()
  } finally { resetRoomState(); closePicker(); clearNote(stageNote); leaveButton.disabled = false; renderChrome(); void refreshRooms() }
}

function resetRoomState(): void {
  setTheater(false)
  currentRoom = null; connection = 'offline'; streams = []; participants = []; selectedStreamId = null; hideLocalPreview = false; gridView = false; telemetry = {}; lastGridSignature = ''; streamVolumes.clear(); hearButton.hidden = true
}

function selectBestStream(): void {
  const candidate = hideLocalPreview ? streams.find((stream) => !stream.local) : streams.find((stream) => stream.local) ?? streams[0]
  selectedStreamId = candidate?.id ?? null; selectStream(selectedStreamId)
}

function renderChrome(): void {
  const inRoom = currentRoom !== null
  const localStream = streams.find((stream) => stream.local)
  const visibleStreams = streams.filter((stream) => !hideLocalPreview || !stream.local)
  document.body.classList.toggle('in-room', inRoom)
  roomSidebar.hidden = !inRoom
  elementById('stage-head').hidden = !inRoom && !joining
  roomTitle.textContent = inRoom ? currentRoom : 'Rooms'
  stage.classList.toggle('is-idle', !inRoom); shareButton.hidden = !inRoom; labelButton(shareButton, localStream ? 'Change screen' : 'Share screen'); hideMyScreenButton.hidden = !localStream
  shareButton.disabled = connection !== 'connected'
  shareButton.setAttribute('aria-pressed', String(Boolean(localStream)))
  labelButton(hideMyScreenButton, hideLocalPreview ? 'Show my screen' : 'Hide my screen')
  hideMyScreenButton.innerHTML = icon(hideLocalPreview ? 'eye-off' : 'eye')
  hideMyScreenButton.setAttribute('aria-pressed', String(hideLocalPreview))
  stopButton.hidden = !localStream; leaveButton.hidden = !inRoom
  const hasVideo = visibleStreams.length > 0
  syncScreenControlsVisibility(hasVideo)
  fullscreenButton.hidden = !hasVideo
  popOutButton.hidden = !hasVideo || gridView
  const canUseGrid = streams.length > 0 && participants.length > 1
  gridViewButton.hidden = !canUseGrid
  labelButton(gridViewButton, gridView ? 'Focus selected stream' : 'Show all streams')
  gridViewButton.setAttribute('aria-pressed', String(gridView))
  theaterButton.hidden = !hasVideo
  const useGrid = gridView && canUseGrid
  popOutButton.hidden = !hasVideo || useGrid
  video.hidden = useGrid || !selectedStreamId
  streamGrid.hidden = !useGrid
  setStageVideoVisible(!useGrid && Boolean(selectedStreamId))
  renderFocusedStreamVolume(useGrid)
  renderGrid(useGrid)
  elementById('call-controls').hidden = !inRoom
  renderTelemetry()
  renderParticipantTiles(inRoom && !useGrid && !selectedStreamId && participants.length > 0)
  if (!inRoom) {
    waiting.hidden = false
    waiting.setAttribute('aria-label', serverUnavailable ? 'Could not connect to the server' : 'Select a room')
    waitingMessage.hidden = !serverUnavailable
    waitingMessage.textContent = serverUnavailable ? 'Could not connect to the server.' : ''
    membersPanel.hidden = true
    renderRooms()
    return
  }
  waitingMessage.hidden = true
  waiting.hidden = selectedStreamId !== null || participants.length > 0
  if (selectedStreamId === null) waiting.setAttribute('aria-label', hideLocalPreview && localStream ? 'Local preview hidden' : 'No screens')
}

function renderFocusedStreamVolume(useGrid: boolean): void {
  const stream = streams.find((candidate) => candidate.id === selectedStreamId)
  const visible = !useGrid && stream !== undefined && !stream.local
  focusedStreamVolume.hidden = !visible
  if (!stream) return
  const value = Math.round((streamVolumes.get(stream.id) ?? 1) * 100)
  focusedStreamVolumeInput.value = String(value)
  focusedStreamVolumeInput.setAttribute('aria-label', `Volume for ${stream.participantName}`)
  focusedStreamVolumeInput.title = `Volume for ${stream.participantName}: ${value}%`
  focusedStreamVolumeValue.value = `${value}%`
  focusedStreamVolumeValue.textContent = `${value}%`
  focusedStreamMuteButton.innerHTML = icon(stream.muted ? 'volume-off' : 'volume')
  labelButton(focusedStreamMuteButton, `${stream.muted ? 'Unmute' : 'Mute'} ${stream.participantName}`)
  focusedStreamMuteButton.setAttribute('aria-pressed', String(stream.muted))
}

function syncFocusedStreamVolume(): void {
  const stream = streams.find((candidate) => candidate.id === selectedStreamId)
  if (!stream || stream.local) return
  const value = Math.max(0, Math.min(100, Number(focusedStreamVolumeInput.value) || 0)) / 100
  streamVolumes.set(stream.id, value)
  focusedStreamVolumeValue.value = `${Math.round(value * 100)}%`
  focusedStreamVolumeValue.textContent = focusedStreamVolumeValue.value
  focusedStreamVolumeInput.title = `Volume for ${stream.participantName}: ${focusedStreamVolumeValue.value}`
  setStreamVolume(stream.id, value)
}

function renderGrid(active: boolean): void {
  const visibleStreams = streams.filter((stream) => !hideLocalPreview || !stream.local)
  const signature = active ? JSON.stringify({ participants, streams: visibleStreams.map((stream) => [stream.id, stream.muted, streamVolumes.get(stream.id) ?? 1]) }) : ''
  if (signature === lastGridSignature) return
  lastGridSignature = signature
  if (!active) {
    streamGrid.replaceChildren()
    setGridVideos(new Map())
    return
  }
  const targets = new Map<string, HTMLVideoElement>()
  const tiles = document.createDocumentFragment()
  for (const participant of participants) {
    const stream = visibleStreams.find((candidate) => candidate.participantId === participant.id)
    const tile = Object.assign(document.createElement('article'), { className: 'grid-tile' })
    if (stream) {
      tile.classList.add('is-stream')
      tile.tabIndex = 0
      tile.setAttribute('role', 'button')
      tile.setAttribute('aria-label', `Focus ${stream.participantName}'s screen`)
      const focus = () => { gridView = false; hideLocalPreview = false; selectedStreamId = stream.id; selectStream(stream.id); renderChrome() }
      tile.addEventListener('click', focus)
      tile.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); focus() } })
      const tileVideo = document.createElement('video')
      tileVideo.autoplay = true
      tileVideo.playsInline = true
      tileVideo.muted = true
      tile.append(tileVideo)
      targets.set(stream.id, tileVideo)
      if (!stream.local) {
        const audioControls = Object.assign(document.createElement('div'), { className: 'grid-stream-audio-controls' })
        const mute = Object.assign(document.createElement('button'), { type: 'button', className: 'grid-tile-mute' })
        mute.innerHTML = icon(stream.muted ? 'volume-off' : 'volume')
        labelButton(mute, `${stream.muted ? 'Unmute' : 'Mute'} ${stream.participantName}`)
        mute.setAttribute('aria-pressed', String(stream.muted))
        mute.addEventListener('click', (event) => { event.stopPropagation(); setStreamMuted(stream.id, !stream.muted) })
        const volume = Object.assign(document.createElement('input'), { type: 'range', className: 'grid-tile-volume', min: '0', max: '100', value: String(Math.round((streamVolumes.get(stream.id) ?? 1) * 100)) })
        volume.setAttribute('aria-label', `Volume for ${stream.participantName}`)
        volume.title = `Volume for ${stream.participantName}: ${volume.value}%`
        const updateVolume = (event: Event) => {
          event.stopPropagation()
          const value = Math.max(0, Math.min(100, Number((event.currentTarget as HTMLInputElement).value) || 0)) / 100
          streamVolumes.set(stream.id, value)
          const input = event.currentTarget as HTMLInputElement
          input.title = `Volume for ${stream.participantName}: ${Math.round(value * 100)}%`
          setStreamVolume(stream.id, value)
        }
        volume.addEventListener('input', updateVolume)
        volume.addEventListener('click', (event) => event.stopPropagation())
        audioControls.append(volume, mute)
        tile.append(audioControls)
      }
    } else {
      tile.classList.add('is-participant')
      tile.style.setProperty('--avatar-hue', String(avatarHue(participant.name)))
      tile.append(makeAvatar(participant.name))
    }
    tile.append(Object.assign(document.createElement('span'), { className: 'grid-tile-label', textContent: participant.name, title: participant.local ? 'You' : participant.name }))
    tiles.append(tile)
  }
  streamGrid.replaceChildren(tiles)
  setGridVideos(targets)
}

function renderMembers(): void {
  membersList.replaceChildren()
  membersPanel.hidden = currentRoom === null
  membersCount.textContent = String(participants.length)
  for (const participant of participants) {
    const member = Object.assign(document.createElement('div'), { className: 'member' })
    member.append(makeAvatar(participant.name))
    member.append(Object.assign(document.createElement('span'), { className: 'member-name', textContent: participant.name }))
    if (participant.local) member.title = 'You'
    membersList.append(member)
  }
}


function syncQualityControls(): void {
  const resolution = resolutionInput.value as ShareResolution
  for (const option of [...frameRateInput.options]) option.disabled = !isQualityAllowed(resolution, Number(option.value) as ShareFrameRate)
  if (frameRateInput.selectedOptions[0]?.disabled) frameRateInput.value = resolution === '4k' ? '24' : '60'
  const frameRate = Number(frameRateInput.value) as ShareFrameRate
  const bitrateMode = bitrateModeInput.value as ShareBitrateMode
  const range = shareBitrateRangeFor({ resolution, frameRate })
  bitrateInput.min = String(range.min)
  bitrateInput.max = String(range.max)
  const selectedBitrate = Number(bitrateInput.value)
  if (!Number.isFinite(selectedBitrate) || selectedBitrate < range.min || selectedBitrate > range.max) bitrateInput.value = String(range.max)
  const bitrate = Number(bitrateInput.value)
  fixedBitrateField.hidden = bitrateMode !== 'fixed'
  bitrateValue.value = formatBitrate(bitrate)
  bitrateValue.textContent = bitrateValue.value
  resolutionInput.title = `${formatBitrate(range.min)}–${formatBitrate(range.max)}`
  frameRateInput.title = resolution === '4k' ? '4K: 5, 15, or 24 FPS' : 'Frame rate'
  bitrateInput.title = `Fixed bitrate: ${formatBitrate(bitrate)}`
  bitrateModeInput.title = bitrateMode === 'fixed' ? `Fixed target: ${formatBitrate(bitrate)}` : `Adaptive range: ${formatBitrate(range.min)}–${formatBitrate(range.max)}`
}

function syncSystemAudioControls(): void {
  blockDiscordInput.disabled = !audioInput.checked
  if (!audioInput.checked) blockDiscordInput.checked = false
  blockDiscordInput.title = audioInput.checked ? 'Exclude Discord audio' : 'Enable system audio first'
}

function syncAudioControls(): void {
  syncAudioVolume()
  const supported = supportsRemoteAudioOutputSelection()
  audioOutputInput.disabled = !supported
  refreshAudioOutputButton.disabled = !supported
  audioOutputNote.hidden = supported
  audioOutputNote.textContent = supported ? '' : 'This version cannot select a stream-audio output device.'
}

function syncAudioVolume(): void {
  const value = Math.max(0, Math.min(100, Number(audioVolumeInput.value) || 0))
  audioVolumeInput.value = String(value)
  audioVolumeValue.value = `${value}%`
  audioVolumeValue.textContent = `${value}%`
  audioVolumeInput.title = `Incoming screen-audio volume: ${value}%`
  setRemoteAudioVolume(value / 100)
}

async function loadAudioOutputs(): Promise<void> {
  if (!supportsRemoteAudioOutputSelection() || !navigator.mediaDevices?.enumerateDevices) return
  try {
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === 'audiooutput')
    const selectionExists = selectedAudioOutput === 'default' || devices.some((device) => device.deviceId === selectedAudioOutput)
    if (!selectionExists) selectedAudioOutput = 'default'
    audioOutputInput.replaceChildren(Object.assign(document.createElement('option'), { value: 'default', textContent: 'System default' }))
    devices.forEach((device, index) => {
      if (device.deviceId === 'default') return
      audioOutputInput.append(Object.assign(document.createElement('option'), {
        value: device.deviceId,
        textContent: device.label || `Audio output ${index + 1}`,
      }))
    })
    audioOutputInput.value = selectedAudioOutput
    audioOutputNote.hidden = true
  } catch (error) {
    audioOutputNote.hidden = false
    audioOutputNote.textContent = `Could not list audio outputs: ${messageOf(error)}`
  }
}

async function onAudioOutputChanged(): Promise<void> {
  const previous = selectedAudioOutput
  const next = audioOutputInput.value
  try {
    await setRemoteAudioOutputDevice(next)
    selectedAudioOutput = next
    audioOutputNote.hidden = true
  } catch (error) {
    audioOutputInput.value = previous
    audioOutputNote.hidden = false
    audioOutputNote.textContent = `Could not use that audio output: ${messageOf(error)}`
  }
}

function readQuality(): ShareQuality | null {
  const resolution = resolutionInput.value as ShareResolution; const frameRate = Number(frameRateInput.value) as ShareFrameRate; const bitrateMode = bitrateModeInput.value as ShareBitrateMode; const bitrate = Number(bitrateInput.value)
  if (!isQualityAllowed(resolution, frameRate)) { showNote(pickerNote, 'This resolution and frame rate cannot be used together.', 'error'); return null }
  return { resolution, frameRate, bitrateMode, bitrate }
}

function isQualityAllowed(resolution: ShareResolution, frameRate: ShareFrameRate): boolean {
  if (resolution === '4k') return frameRate === 5 || frameRate === 15 || frameRate === 24
  return true
}

function renderTelemetry(): void {
  const hasMetrics = Boolean(telemetry.sent || telemetry.received)
  const focusView = currentRoom !== null && !gridView && selectedStreamId !== null
  streamMetrics.hidden = !hasMetrics || !showStatistics || !focusView
  if (streamMetrics.hidden) streamMetricsHovered = false
  renderMetricCard(hostMetrics, telemetry.sent, 'host')
  renderMetricCard(viewerMetrics, telemetry.received, 'viewer')
}

function renderMetricCard(card: HTMLElement, metric: StreamMetric | undefined, side: 'host' | 'viewer'): void {
  card.hidden = !metric
  if (!metric) return
  const quality = metric.width && metric.height ? `${metric.width} × ${metric.height}` : '—'
  const baseRows: Array<[string, string]> = [
    ['Video', quality],
    ['Bitrate', formatBitrate(metric.bitrate)],
    ['Frame rate', metric.frameRate ? `${Math.round(metric.frameRate)} fps` : '—'],
    ['Packet rate', metric.packetRate ? `${Math.round(metric.packetRate)} /s` : '—'],
    ['Jitter', formatMilliseconds(metric.jitterMs)],
    ['Packet loss', formatPacketLoss(metric)],
    ['Packets', formatCount(metric.packets)],
    ['Frames', formatCount(metric.frames)],
    ['Data', formatBytes(metric.bytes)],
  ]
  const networkRows: Array<[string, string]> = side === 'host'
    ? [['Target', formatBitrate(metric.targetBitrate)], ['RTT', formatMilliseconds(metric.roundTripTimeMs)]]
    : [['Buffer', formatMilliseconds(metric.jitterBufferDelayMs)], ['Decode', formatMilliseconds(metric.decodeTimeMs)]]
  const rows = [...baseRows.slice(0, 3), ...networkRows, ...baseRows.slice(3)]
  const list = card.querySelector('dl')!
  list.replaceChildren(...rows.map(([label, value]) => {
    const row = document.createElement('div')
    const term = Object.assign(document.createElement('dt'), { textContent: label })
    const detail = Object.assign(document.createElement('dd'), { textContent: value })
    row.append(term, detail)
    return row
  }))
}

function formatMilliseconds(value: number | undefined): string { return value === undefined ? '—' : `${Math.round(value)} ms` }
function formatPacketLoss(metric: StreamMetric): string {
  if (metric.packetLossPercent === undefined) return metric.packetsLost === undefined ? '—' : `${formatCount(metric.packetsLost)} lost`
  return `${metric.packetLossPercent.toFixed(metric.packetLossPercent < 1 ? 2 : 1)}% · ${formatCount(metric.packetsLost ?? 0)} lost`
}
function formatCount(value: number): string { return new Intl.NumberFormat().format(Math.round(value)) }
function formatBytes(value: number): string {
  if (value < 1_000) return `${Math.round(value)} B`
  if (value < 1_000_000) return `${(value / 1_000).toFixed(1)} KB`
  return `${(value / 1_000_000).toFixed(2)} MB`
}


function formatBitrate(bits: number | undefined): string {
  if (!bits) return '—'
  if (bits >= 1_000_000) return `${(bits / 1_000_000).toFixed(1)} Mb/s`
  return `${Math.round(bits / 1_000)} Kb/s`
}

function updatePickerControls(): void { goLiveButton.disabled = publishing || selectedSourceId === null || sourcesEl.getAttribute('aria-busy') === 'true' }
function requireName(): boolean { if (nameInput.value.trim()) return true; openSettings(); showNote(settingsNote, 'Add a display name before joining a room.', 'warn'); nameInput.focus(); return false }
async function persistConfig(): Promise<AppConfig | null> {
  try {
    const saved = await window.sharescreen.saveConfig(readForm())
    if (!saved.ok) { openServerSettings(); showNote(serverNote, saved.error, 'error'); return null }
    fillForm(saved.value); return saved.value
  } catch (error) { openServerSettings(); showNote(serverNote, messageOf(error), 'error'); return null }
}
function readForm(): AppConfig { return { url: urlInput.value, apiKey: keyInput.value, apiSecret: secretInput.value, displayName: nameInput.value, showStreamStatistics: showStreamStatisticsInput.checked } }
function fillForm(config: AppConfig): void {
  savedConfig = config
  urlInput.value = config.url; keyInput.value = config.apiKey; secretInput.value = config.apiSecret; nameInput.value = config.displayName
  showStatistics = config.showStreamStatistics
  showStreamStatisticsInput.checked = showStatistics
  elementById('profile-name').textContent = config.displayName || 'Name'
  elementById('profile-avatar').textContent = initials(config.displayName)
  elementById('profile-avatar').style.setProperty('--avatar-hue', String(avatarHue(config.displayName)))
}
function openSettings(): void { clearNote(settingsNote); if (!settingsDialog.open) settingsDialog.showModal() }
function openServerSettings(): void { clearNote(serverNote); if (!serverDialog.open) serverDialog.showModal() }
function syncScreenControlsVisibility(hasVideo: boolean): void {
  if (!hasVideo) {
    screenControlsVisible = false
    if (screenControlsTimer !== null) window.clearTimeout(screenControlsTimer)
    screenControlsTimer = null
    stageWrap.classList.remove('screen-controls-idle')
    return
  }
  if (!screenControlsVisible) {
    screenControlsVisible = true
    revealScreenControls()
  }
}

function revealScreenControls(): void {
  stageWrap.classList.remove('screen-controls-idle')
  if (screenControlsTimer !== null) window.clearTimeout(screenControlsTimer)
  if (!screenControlsVisible) return
  screenControlsTimer = window.setTimeout(hideScreenControls, 1_500)
}

function hideScreenControls(): void {
  screenControlsTimer = null
  if (streamMetricsHovered && !streamMetrics.hidden) {
    revealScreenControls()
    return
  }
  stageWrap.classList.add('screen-controls-idle')
}

function setTheater(active: boolean): void {
  document.body.classList.toggle('theater', active)
  labelButton(theaterButton, active ? 'Exit focus' : 'Focus view')
  elementById('exit-focus').hidden = !active
  if (active) revealScreenControls()
}
function initials(name: string): string { return name.trim().split(/\s+/).slice(0, 2).map((part) => [...part][0] ?? '').join('').toUpperCase() || '?' }
function avatarHue(name: string): number { return [...name].reduce((hash, character) => (hash * 31 + character.charCodeAt(0)) % 360, 252) }
function makeAvatar(name: string): HTMLSpanElement { const avatar = Object.assign(document.createElement('span'), { className: 'avatar', textContent: initials(name) }); avatar.style.setProperty('--avatar-hue', String(avatarHue(name))); avatar.setAttribute('aria-hidden', 'true'); return avatar }
function renderParticipantTiles(active: boolean): void {
  participantGrid.hidden = !active
  if (!active) return
  const signature = JSON.stringify(participants)
  if (participantGrid.dataset.signature === signature) return
  participantGrid.dataset.signature = signature
  participantGrid.style.setProperty('--participant-rows', String(Math.ceil(participants.length / 2)))
  participantGrid.replaceChildren(...participants.map((participant) => {
    const tile = Object.assign(document.createElement('article'), { className: 'participant-tile' })
    tile.style.setProperty('--avatar-hue', String(avatarHue(participant.name)))
    tile.append(makeAvatar(participant.name), Object.assign(document.createElement('span'), { className: 'participant-name', textContent: participant.name, title: participant.local ? 'You' : participant.name }))
    return tile
  }))
}
function setPickerBusy(busy: boolean): void {
  for (const control of picker.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('button, input, select')) control.disabled = busy
  sourcesEl.classList.toggle('is-locked', busy)
  if (!busy) { syncSystemAudioControls(); syncQualityControls() }
}
function showNote(note: HTMLParagraphElement, message: string, tone: 'error' | 'warn'): void { note.hidden = false; note.dataset.tone = tone; note.textContent = message }
function clearNote(note: HTMLParagraphElement): void { note.hidden = true; note.textContent = ''; delete note.dataset.tone }
function messageOf(error: unknown): string { return error instanceof Error && error.message ? error.message : 'Something went wrong' }
function byId<T extends HTMLElement>(id: string, ctor: new () => T): T { const found = document.getElementById(id); if (!(found instanceof ctor)) throw new Error(`Missing #${id}`); return found }
function elementById(id: string): HTMLElement { const found = document.getElementById(id); if (!(found instanceof HTMLElement)) throw new Error(`Missing #${id}`); return found }
