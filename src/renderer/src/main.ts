import { shareBitrateRangeFor, supportsShareQuality, type AppConfig, type CaptureAccelerationStatus, type DesktopSourceInfo, type Role, type RoomSummary, type ShareBitrateMode, type ShareFrameRate, type SharePriority, type ShareQuality, type ShareResolution } from '../../shared/types'
import { hideStream, joinRoom, leaveRoom, publishScreen, resumeRemoteAudio, selectStream, sendChatMessage, setGridVideos, setRemoteAudioOutputDevice, setRemoteAudioVolume, setStageVideoVisible, setStreamMuted, setStreamVolume, supportsRemoteAudioOutputSelection, unpublishScreen, updateDisplayName, watchStream, type Presence, type RoomParticipant, type ScreenStream, type SessionHooks, type StreamMetric, type StreamTelemetry } from './session'
import { hydrateIcons, icon, labelButton } from './icons'
import { RoomChat } from './chat'
import { configureVoice, setVoiceInputVolume, setVoiceMuted, setVoiceDeafened, setVoiceParticipantMuted } from './session'
import type { VoiceState } from './voice'

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
const fullscreenFocusButton = byId('fullscreen-focus', HTMLButtonElement)
const popOutButton = byId('pop-out', HTMLButtonElement)
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
const focusedStreamHideButton = byId('focused-stream-hide', HTMLButtonElement)
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
const priorityInput = byId('share-priority', HTMLSelectElement)
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
const checkForUpdatesOnStartupInput = byId('check-for-updates-on-startup', HTMLInputElement)
const updateChannelInput = byId('update-channel', HTMLSelectElement)
const showChatBubblesInput = byId('show-chat-bubbles', HTMLInputElement)
const voiceEnabledInput = byId('voice-enabled', HTMLInputElement)
const voiceInput = byId('voice-input', HTMLSelectElement)
const voiceInputNote = byId('voice-input-note', HTMLParagraphElement)
const refreshVoiceInputButton = byId('refresh-voice-input', HTMLButtonElement)
let voiceState: VoiceState = { enabled: true, muted: true, deafened: false, busy: false, participants: [] }
const voiceInputVolume = byId('voice-input-volume', HTMLInputElement)
const voiceInputVolumeValue = byId('voice-input-volume-value', HTMLOutputElement)
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
// Session callbacks arrive before connect() resolves. Commit their state to
// the room UI together, instead of painting a partially joined lobby.
let joiningSession = false
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
let captureAccelerationStatus: CaptureAccelerationStatus | null = null
let lastGridSignature = ''
let roomsFingerprint = ''
let selectedAudioOutput = 'default'
let windowFullscreen = false
let screenControlsVisible = false
let screenControlsTimer: number | null = null
const streamVolumes = new Map<string, number>()
let roomPendingDeletion: string | null = null
const chat = new RoomChat(sendChatMessage, makeAvatar, () => renderMembers())

const hooks: SessionHooks = {
  onVoice: (state) => { voiceState = state; syncVoiceUI() },
  onRoomLost: () => chat.clearHistory(),
  onChatMessage: (message) => chat.receive(message),
  onConnection: (state) => {
    if (state === 'reconnecting' && connection !== 'reconnecting') chat.clearHistory()
    connection = state
    renderChrome()
  },
  onViewers: () => renderChrome(),
  onParticipants: (next) => {
    // SDK events and server roster polls can list the same people in different
    // orders. Normalize both before comparing so polls do not shuffle/rebuild UI.
    const ordered = [...next].sort(compareParticipants)
    if (ordered.length === participants.length && ordered.every((participant, index) => {
      const previous = participants[index]
      return participant.id === previous.id && participant.name === previous.name && participant.local === previous.local
    })) return
    participants = ordered
    if (!joiningSession) chat.setParticipants(ordered)
    renderMembers()
    renderChrome()
  },
  onStreams: (next) => {
    // Opening the overview is safe: unpublished/unselected cards do not have
    // a media track attached, so they consume neither video decode nor audio.
    const selected = selectedStreamId ? next.find((stream) => stream.id === selectedStreamId) : undefined
    if ((next.length > 1 && (!selected || selected.local)) || (next.some((stream) => !stream.local) && streams.length === 0)) gridView = true
    streams = next
    for (const id of streamVolumes.keys()) if (!next.some((stream) => stream.id === id)) streamVolumes.delete(id)
    if (selectedStreamId && !streams.some((stream) => stream.id === selectedStreamId)) selectedStreamId = null
    if (!selectedStreamId && next.some((stream) => stream.local)) selectBestStream()
    renderMembers()
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
  void loadVoiceInputs()
  void refreshRooms()
  // Room events keep an open room current instantly. The lobby poll is only a
  // fallback for other rooms and deliberately does not rebuild the video UI
  // when the response is unchanged.
  window.setInterval(() => void refreshRooms(), 5_000)
}

function bind(): void {
  const settingsTabs = [...settingsDialog.querySelectorAll<HTMLButtonElement>('[data-settings-tab]')]
  settingsTabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectSettingsTab(tab.dataset.settingsTab!))
    tab.addEventListener('keydown', (event) => {
      const next = event.key === 'ArrowDown' ? (index + 1) % settingsTabs.length :
        event.key === 'ArrowUp' ? (index + settingsTabs.length - 1) % settingsTabs.length :
        event.key === 'Home' ? 0 : event.key === 'End' ? settingsTabs.length - 1 : -1
      if (next < 0) return
      event.preventDefault()
      settingsTabs[next].click()
      settingsTabs[next].focus()
    })
  })
  createForm.addEventListener('submit', (event) => { event.preventDefault(); void onCreateRoom() })
  document.querySelectorAll<HTMLButtonElement>('[data-create-room]').forEach((button) => button.addEventListener('click', () => {
    clearNote(createNote)
    createDialog.showModal()
    newRoomInput.focus()
  }))
  document.querySelectorAll<HTMLButtonElement>('[data-settings]').forEach((button) => button.addEventListener('click', () => openSettings()))
  elementById('lobby-settings').addEventListener('click', openSettings)
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
      if (currentRoom) {
        try { await configureVoice({ enabled: saved.voiceEnabled, inputDeviceId: saved.voiceInputDeviceId, inputVolume: saved.voiceInputVolume }) }
        catch (error) { showNote(settingsNote, `Settings saved. ${messageOf(error)}`, 'error'); return }
      }
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
  byId('check-for-updates', HTMLButtonElement).addEventListener('click', async () => {
    const button = byId('check-for-updates', HTMLButtonElement)
    button.disabled = true
    try {
      clearNote(settingsNote)
      const result = await window.sharescreen.checkForUpdates(updateChannelInput.value === 'beta' ? 'beta' : 'stable')
      if (!result.ok) showNote(settingsNote, result.error, 'error')
    } finally { button.disabled = false }
  })
  byId('confirm-delete-room', HTMLButtonElement).addEventListener('click', () => {
    const name = roomPendingDeletion
    if (name) void onDelete(name)
  })
  elementById('exit-focus').addEventListener('click', () => void exitFocusView())
  picker.addEventListener('cancel', (event) => { event.preventDefault(); if (!publishing) closePicker() })
  shareButton.addEventListener('click', () => void openPicker())
  fullscreenButton.addEventListener('click', () => void toggleFullscreen())
  fullscreenFocusButton.addEventListener('click', () => void toggleFullscreen())
  popOutButton.addEventListener('click', () => void popOutVideo())
  theaterButton.addEventListener('click', () => {
    setTheater(!document.body.classList.contains('theater'))
  })
  hideMyScreenButton.addEventListener('click', () => {
    hideLocalPreview = !hideLocalPreview
    // Keep a hidden local share reachable from the same available-stream card
    // used for remote shares, instead of removing it from the overview.
    if (hideLocalPreview) gridView = true
    selectBestStream()
    renderChrome()
  })
  stageWrap.addEventListener('pointermove', revealScreenControls)
  stageWrap.addEventListener('pointerdown', revealScreenControls)
  stageWrap.addEventListener('focusin', revealScreenControls)
  video.addEventListener('click', () => {
    if (streams.length && participants.length > 1) { gridView = true; renderChrome() }
  })
  focusedStreamVolumeInput.addEventListener('input', syncFocusedStreamVolume)
  // These overlays sit above a clickable video. Stop the whole pointer/click
  // sequence here so no control interaction can also switch to the grid.
  for (const eventName of ['pointerdown', 'click']) focusedStreamVolume.addEventListener(eventName, (event) => event.stopPropagation())
  focusedStreamMuteButton.addEventListener('click', (event) => {
    event.stopPropagation()
    const stream = streams.find((candidate) => candidate.id === selectedStreamId)
    if (!stream || stream.local) return
    setStreamMuted(stream.id, !stream.muted)
    revealScreenControls()
  })
  focusedStreamHideButton.addEventListener('pointerdown', (event) => event.stopPropagation())
  focusedStreamHideButton.addEventListener('click', (event) => {
    event.stopPropagation()
    const stream = streams.find((candidate) => candidate.id === selectedStreamId)
    if (!stream || stream.local) return
    selectedStreamId = null
    gridView = true
    hideStream(stream.id)
    renderChrome()
  })
  stopButton.addEventListener('click', () => void onStop())
  leaveButton.addEventListener('click', () => void onLeave())
  hearButton.addEventListener('click', () => void resumeRemoteAudio())
  refreshButton.addEventListener('click', () => void loadSources())
  audioInput.addEventListener('change', syncSystemAudioControls)
  audioVolumeInput.addEventListener('input', syncAudioVolume)
  voiceInputVolume.addEventListener('input', syncVoiceInputVolume)
  showStreamStatisticsInput.addEventListener('change', () => {
    showStatistics = showStreamStatisticsInput.checked
    renderTelemetry()
  })
  audioOutputInput.addEventListener('change', () => void onAudioOutputChanged())
  refreshAudioOutputButton.addEventListener('click', () => void loadAudioOutputs())
  refreshVoiceInputButton.addEventListener('click', () => void loadVoiceInputs())
  voiceEnabledInput.addEventListener('change', syncVoiceSettings)
  for (const id of ['voice-mute', 'voice-focus-mute']) elementById(id).addEventListener('click', () => void changeVoice(() => setVoiceMuted(!voiceState.muted)))
  for (const id of ['voice-deafen', 'voice-focus-deafen']) elementById(id).addEventListener('click', () => void changeVoice(() => setVoiceDeafened(!voiceState.deafened)))
  navigator.mediaDevices?.addEventListener?.('devicechange', () => { void loadAudioOutputs(); void loadVoiceInputs() })
  pickerForm.addEventListener('submit', (event) => { event.preventDefault(); void onGoLive() })
  cancelShareButton.addEventListener('click', closePicker)
  resolutionInput.addEventListener('change', syncQualityControls)
  frameRateInput.addEventListener('change', syncQualityControls)
  priorityInput.addEventListener('change', syncQualityControls)
  bitrateModeInput.addEventListener('change', syncQualityControls)
  bitrateInput.addEventListener('input', syncQualityControls)
  window.sharescreen.onWindowFullscreenChanged((active) => {
    windowFullscreen = active
    if (!active) setTheater(false)
    syncFullscreenLabel()
  })
  document.addEventListener('keydown', (event) => {
    if (stageWrap.contains(document.activeElement)) revealScreenControls()
    if (event.key === 'Escape' && windowFullscreen) {
      void toggleFullscreen()
    } else if (event.key === 'Escape' && document.body.classList.contains('theater')) {
      exitFocusView()
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
      chat.clearHistory()
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
    chat.clearHistory()
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
  joiningSession = true
  const workspace = elementById('room-workspace')
  workspace.inert = true
  chat.setConnection(false)
  const pendingMessages: Parameters<SessionHooks['onChatMessage']>[0][] = []
  let chatReady = false
  try {
    await joinRoom({
      url: issued.value.url,
      token: issued.value.token,
      subscribe: false,
      voice: { enabled: saved.voiceEnabled, inputDeviceId: saved.voiceInputDeviceId, inputVolume: saved.voiceInputVolume },
      media: { video, audioRack },
      hooks: {
        ...hooks,
        onChatMessage: (message) => {
          if (chatReady) hooks.onChatMessage(message)
          else pendingMessages.push(message)
        },
      },
      roster: async () => {
        const roster = await window.sharescreen.listRoomParticipants({ name: roomName })
        if (!roster.ok) throw new Error(roster.error)
        return roster.value
      },
    })
  } catch (error) {
    workspace.inert = false
    joiningSession = false
    chat.clearHistory(); resetRoomState(); showNote(picker.open ? pickerNote : stageNote, messageOf(error), 'error'); renderChrome(); return false
  }
  workspace.inert = false
  joiningSession = false
  currentRoom = roomName
  hideLocalPreview = false
  chat.begin(roomName, issued.value.url)
  chat.setParticipants(participants)
  clearNote(stageNote); renderRooms(); renderMembers(); renderChrome()
  chatReady = true
  pendingMessages.forEach((message) => chat.receive(message))
  pendingMessages.length = 0
  void refreshRooms()
  return true
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
  for (const button of [fullscreenButton, fullscreenFocusButton]) {
    labelButton(button, windowFullscreen ? 'Exit fullscreen' : 'Fullscreen')
    button.innerHTML = icon(windowFullscreen ? 'collapse' : 'expand')
    button.setAttribute('aria-pressed', String(windowFullscreen))
  }
}

function exitFocusView(): void { setTheater(false) }

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
  picker.showModal(); clearNote(pickerNote); syncSystemAudioControls(); syncQualityControls()
  void loadCaptureAcceleration()
  await loadSources()
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

async function loadCaptureAcceleration(): Promise<void> {
  try {
    const status = await window.sharescreen.getCaptureAcceleration()
    captureAccelerationStatus = status
    renderTelemetry()
  } catch {
    captureAccelerationStatus = null
  }
}

function gpuFeatureLabel(status: CaptureAccelerationStatus | null): string {
  if (!status) return 'Unavailable'
  if (!status.ready) return 'Checking'
  return status.videoEncode === 'enabled' ? 'Enabled' : `${status.videoEncode} (CPU fallback possible)`
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
  chat.reset()
}

function selectBestStream(): void {
  const candidate = hideLocalPreview ? undefined : streams.find((stream) => stream.local)
  selectedStreamId = candidate?.id ?? null; selectStream(selectedStreamId)
}

function renderChrome(): void {
  syncVoiceUI()
  if (joiningSession) return
  const inRoom = currentRoom !== null
  chat.setConnection(connection === 'connected' && inRoom)
  const localStream = streams.find((stream) => stream.local)
  const visibleStreams = streams.filter((stream) => !hideLocalPreview || !stream.local)
  document.body.classList.toggle('in-room', inRoom)
  roomSidebar.hidden = !inRoom
  elementById('stage-head').hidden = !inRoom
  roomTitle.textContent = inRoom ? currentRoom : 'Rooms'
  stage.classList.toggle('is-idle', !inRoom); shareButton.hidden = !inRoom; labelButton(shareButton, localStream ? 'Change screen' : 'Share screen'); hideMyScreenButton.hidden = !localStream
  shareButton.disabled = connection !== 'connected'
  shareButton.setAttribute('aria-pressed', String(Boolean(localStream)))
  labelButton(hideMyScreenButton, hideLocalPreview ? 'Show my screen' : 'Hide my screen')
  hideMyScreenButton.innerHTML = icon(hideLocalPreview ? 'eye-off' : 'eye')
  hideMyScreenButton.setAttribute('aria-pressed', String(hideLocalPreview))
  stopButton.hidden = !localStream; leaveButton.hidden = !inRoom
  const hasVideo = visibleStreams.some((stream) => stream.local || stream.subscribed)
  syncScreenControlsVisibility(hasVideo)
  fullscreenButton.hidden = !hasVideo
  fullscreenFocusButton.hidden = !hasVideo
  popOutButton.hidden = !hasVideo || gridView
  const canUseGrid = streams.length > 0 && (participants.length > 1 || (hideLocalPreview && Boolean(localStream)))
  theaterButton.hidden = !hasVideo
  const useGrid = canUseGrid && (gridView || !hasVideo)
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
  const visible = !useGrid && stream !== undefined && !stream.local && stream.subscribed
  focusedStreamVolume.hidden = !visible
  focusedStreamHideButton.hidden = !visible
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
  labelButton(focusedStreamHideButton, `Hide ${stream.participantName}'s screen`)
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
  if (stream.muted) setStreamMuted(stream.id, false)
}

function renderGrid(active: boolean): void {
  // A hidden local preview remains in the overview as an available stream so
  // its owner can restore it by clicking the card.
  const visibleStreams = streams
  const signature = active ? JSON.stringify({ participants, localPreviewHidden: hideLocalPreview, streams: visibleStreams.map((stream) => [stream.id, stream.subscribed, stream.muted, streamVolumes.get(stream.id) ?? 1]) }) : ''
  if (signature === lastGridSignature) return
  lastGridSignature = signature
  if (!active) {
    streamGrid.replaceChildren()
    setGridVideos(new Map())
    return
  }
  const targets = new Map<string, HTMLVideoElement>()
  const tiles = document.createDocumentFragment()
  const orderedParticipants = [...participants].sort((left, right) => {
    const rank = (participant: RoomParticipant): number => {
      const stream = visibleStreams.find((candidate) => candidate.participantId === participant.id)
      return stream?.subscribed && !(stream.local && hideLocalPreview) ? 0 : stream ? 1 : 2
    }
    const group = rank(left) - rank(right)
    if (group !== 0) return group
    return compareParticipants(left, right)
  })
  for (const participant of orderedParticipants) {
    const stream = visibleStreams.find((candidate) => candidate.participantId === participant.id)
    const tile = Object.assign(document.createElement('article'), { className: 'grid-tile' })
    if (stream && stream.subscribed && !(stream.local && hideLocalPreview)) {
      tile.classList.add('is-stream')
      tile.tabIndex = 0
      tile.setAttribute('role', 'button')
      tile.setAttribute('aria-label', `Focus ${stream.participantName}'s screen`)
      const focus = () => { gridView = false; selectedStreamId = stream.id; watchStream(stream.id); selectStream(stream.id); renderChrome() }
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
        audioControls.addEventListener('pointerdown', (event) => event.stopPropagation())
        audioControls.addEventListener('click', (event) => event.stopPropagation())
        const volume = Object.assign(document.createElement('input'), { type: 'range', className: 'grid-tile-volume', min: '0', max: '100', value: String(Math.round((streamVolumes.get(stream.id) ?? 1) * 100)) })
        volume.id = `stream-volume-${stream.id}`
        volume.setAttribute('aria-label', `Volume for ${stream.participantName}`)
        volume.title = `Volume for ${stream.participantName}: ${volume.value}%`
        const volumeValue = Object.assign(document.createElement('output'), { className: 'grid-tile-volume-value', value: `${volume.value}%` })
        volumeValue.setAttribute('for', volume.id)
        const updateVolume = (event: Event) => {
          event.stopPropagation()
          const value = Math.max(0, Math.min(100, Number((event.currentTarget as HTMLInputElement).value) || 0)) / 100
          streamVolumes.set(stream.id, value)
          const input = event.currentTarget as HTMLInputElement
          input.title = `Volume for ${stream.participantName}: ${Math.round(value * 100)}%`
          volumeValue.value = `${Math.round(value * 100)}%`
          setStreamVolume(stream.id, value)
          if (stream.muted) setStreamMuted(stream.id, false)
        }
        volume.addEventListener('input', updateVolume)
        volume.addEventListener('click', (event) => event.stopPropagation())
        audioControls.append(volume, volumeValue, mute)
        const hideControls = Object.assign(document.createElement('div'), { className: 'grid-stream-hide-control' })
        const hide = Object.assign(document.createElement('button'), { type: 'button', className: 'grid-tile-hide' })
        hide.innerHTML = icon('eye-off')
        labelButton(hide, `Hide ${stream.participantName}'s screen`)
        hide.addEventListener('pointerdown', (event) => event.stopPropagation())
        hide.addEventListener('click', (event) => { event.stopPropagation(); hideStream(stream.id); renderChrome() })
        hideControls.append(hide)
        tile.append(audioControls, hideControls)
      }
    } else if (stream) {
      tile.classList.add('is-stream', 'is-available')
      const watch = () => {
        if (stream.local) hideLocalPreview = false
        selectedStreamId = stream.id; watchStream(stream.id); selectStream(stream.id); renderChrome()
      }
      tile.addEventListener('click', watch)
      const monitor = Object.assign(document.createElement('span'), { className: 'stream-available-monitor' })
      monitor.innerHTML = icon('monitor')
      const status = Object.assign(document.createElement('span'), { className: 'stream-available-status', textContent: 'Sharing screen' })
      // This button fills the card; the visible label is only its call to
      // action, while any click elsewhere on the card starts watching too.
      const startWatching = Object.assign(document.createElement('button'), { type: 'button', className: 'start-watching' })
      labelButton(startWatching, `Click to watch ${stream.participantName}'s screen`)
      startWatching.append(Object.assign(document.createElement('span'), { className: 'start-watching-label', textContent: 'Click to watch' }))
      tile.append(monitor, status, startWatching)
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

function compareParticipants(left: RoomParticipant, right: RoomParticipant): number {
  const name = left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
  // A stable identity tie-breaker also keeps identical display names in place.
  return name || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
}

function renderMembers(): void {
  if (joiningSession) return
  membersList.replaceChildren()
  membersPanel.hidden = currentRoom === null
  membersCount.textContent = String(participants.length)
  const orderedParticipants = [...participants].sort((left, right) => {
    const leftStreaming = streams.some((stream) => stream.participantId === left.id)
    const rightStreaming = streams.some((stream) => stream.participantId === right.id)
    if (leftStreaming !== rightStreaming) return leftStreaming ? -1 : 1
    return compareParticipants(left, right)
  })
  for (const participant of orderedParticipants) {
    const member = Object.assign(document.createElement('div'), { className: 'member' })
    member.dataset.participantId = participant.id
    member.append(makeAvatar(participant.name))
    member.append(Object.assign(document.createElement('span'), { className: 'member-name', textContent: participant.name }))
    if (streams.some((stream) => stream.participantId === participant.id)) {
      const live = Object.assign(document.createElement('span'), { className: 'member-live', textContent: 'LIVE' })
      live.setAttribute('aria-label', `${participant.name} is sharing a screen`)
      member.append(live)
    }
    const actions = Object.assign(document.createElement('div'), { className: `member-actions${participant.local ? ' member-actions-local' : ''}` })
    actions.append(Object.assign(document.createElement('span'), { className: 'member-voice-status' }))
    if (participant.local) member.title = 'You'
    else {
      const mute = Object.assign(document.createElement('button'), { type: 'button', className: 'icon-button member-voice-mute', innerHTML: icon('mic') })
      mute.addEventListener('click', () => {
        const state = voiceState.participants.find(person => person.id === participant.id)
        setVoiceParticipantMuted(participant.id, !state?.locallyMuted)
      })
      actions.append(mute)
      const whisper = Object.assign(document.createElement('button'), { type: 'button', className: 'icon-button member-whisper', innerHTML: icon('chat') })
      whisper.dataset.whisper = participant.id
      labelButton(whisper, `Whisper to ${participant.name}`)
      const unread = chat.unreadFor(participant.id)
      if (unread) whisper.append(Object.assign(document.createElement('span'), { className: 'chat-badge', textContent: unread > 99 ? '+99' : String(unread) }))
      whisper.addEventListener('click', () => chat.whisper(participant.id))
      actions.append(whisper)
    }
    member.append(actions)
    membersList.append(member)
  }
  syncVoiceUI()
}

function syncVoiceUI(): void {
  const available = Boolean(currentRoom) && connection === 'connected' && voiceState.enabled
  for (const id of ['voice-mute', 'voice-focus-mute']) {
    const button = byId(id, HTMLButtonElement)
    button.disabled = !available || voiceState.busy || voiceState.deafened
    button.classList.toggle('is-muted', voiceState.muted)
    button.innerHTML = icon(voiceState.muted ? 'mic-off' : 'mic')
    button.setAttribute('aria-pressed', String(voiceState.muted))
    labelButton(button, !voiceState.enabled ? 'Voice chat disabled in settings' : voiceState.deafened ? 'Microphone muted while deafened' : voiceState.muted ? 'Unmute microphone' : 'Mute microphone')
  }
  for (const id of ['voice-deafen', 'voice-focus-deafen']) {
    const button = byId(id, HTMLButtonElement)
    button.disabled = !available || voiceState.busy
    button.classList.toggle('is-muted', voiceState.deafened)
    button.innerHTML = icon(voiceState.deafened ? 'headphones-off' : 'headphones')
    button.setAttribute('aria-pressed', String(voiceState.deafened))
    labelButton(button, !voiceState.enabled ? 'Voice chat disabled in settings' : voiceState.deafened ? 'Undeafen' : 'Deafen')
  }
  for (const member of membersList.querySelectorAll<HTMLElement>('[data-participant-id]')) {
    const state = voiceState.participants.find(person => person.id === member.dataset.participantId)
    const name = member.querySelector('.member-name')!.textContent
    member.classList.toggle('is-speaking', state?.speaking === true)
    const status = member.querySelector<HTMLElement>('.member-voice-status')!
    status.classList.toggle('voice-disabled', state?.enabled === false)
    const signature = JSON.stringify([state?.muted, state?.deafened, state?.locallyMuted, state?.enabled])
    if (status.dataset.signature !== signature) {
      status.dataset.signature = signature
      status.replaceChildren()
      if (state && (state.muted || state.locallyMuted || !state.enabled)) {
        const remote = !participants.find(person => person.id === member.dataset.participantId)?.local
        const mic = Object.assign(document.createElement(remote ? 'button' : 'span'), { className: remote ? `voice-status-button${state.locallyMuted ? ' voice-local-muted' : ''}` : '', innerHTML: icon('mic-off') })
        mic.title = state.locallyMuted ? `Unmute ${name} for you` : !state.enabled ? `${name} has voice chat disabled` : remote ? `Mute ${name} for you (microphone muted)` : `${name}'s microphone is muted`
        mic.setAttribute('aria-label', mic.title)
        if (mic instanceof HTMLButtonElement) {
          mic.type = 'button'
          mic.addEventListener('click', () => {
            setVoiceParticipantMuted(member.dataset.participantId!, !state.locallyMuted)
            const next = status.querySelector<HTMLButtonElement>('button') ?? member.querySelector<HTMLButtonElement>('.member-voice-mute')
            next?.focus()
          })
        }
        status.append(mic)
      }
      if (state && (state.deafened || !state.enabled)) {
        const headphones = Object.assign(document.createElement('span'), { innerHTML: icon('headphones-off') })
        headphones.title = state.enabled ? `${name} is deafened` : `${name} has voice chat disabled`
        headphones.setAttribute('aria-label', headphones.title)
        status.append(headphones)
      }
    }
    const mute = member.querySelector<HTMLButtonElement>('.member-voice-mute')
    const statusButton = status.querySelector<HTMLButtonElement>('button')
    if (statusButton) statusButton.disabled = !available
    if (mute) {
      // The muted microphone status doubles as the local mute control. Avoid
      // reserving a second invisible microphone slot before the whisper button.
      mute.hidden = state?.muted === true || state?.locallyMuted === true || state?.enabled === false
      mute.disabled = !available
      mute.classList.toggle('voice-local-muted', state?.locallyMuted === true)
      mute.innerHTML = icon(state?.locallyMuted ? 'mic-off' : 'mic')
      mute.setAttribute('aria-pressed', String(state?.locallyMuted === true))
      labelButton(mute, `${state?.locallyMuted ? 'Unmute' : 'Mute'} ${name} for you`)
    }
  }
  const local = voiceState.participants.find(person => participants.some(participant => participant.local && participant.id === person.id))
  elementById('profile-avatar').classList.toggle('is-speaking', local?.speaking === true)
  elementById('profile-name').classList.toggle('is-speaking', local?.speaking === true)
}

async function changeVoice(action: () => Promise<void>): Promise<void> {
  clearNote(stageNote)
  try { await action(); void loadVoiceInputs() }
  catch (error) { showNote(stageNote, messageOf(error), 'error') }
}

function syncVoiceSettings(): void {
  voiceInputVolume.disabled = !voiceEnabledInput.checked
  voiceInput.disabled = !voiceEnabledInput.checked
  refreshVoiceInputButton.disabled = !voiceEnabledInput.checked
}

async function loadVoiceInputs(): Promise<void> {
  if (!navigator.mediaDevices?.enumerateDevices) return
  const selection = voiceInput.value || savedConfig?.voiceInputDeviceId || 'default'
  try {
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'audioinput')
    voiceInput.replaceChildren(Object.assign(document.createElement('option'), { value: 'default', textContent: 'System default' }))
    devices.filter(device => device.deviceId && device.deviceId !== 'default').forEach((device, index) => {
      voiceInput.append(Object.assign(document.createElement('option'), { value: device.deviceId, textContent: device.label || `Microphone ${index + 1}` }))
    })
    if (![...voiceInput.options].some(option => option.value === selection)) voiceInput.append(Object.assign(document.createElement('option'), { value: selection, textContent: 'Unavailable microphone' }))
    voiceInput.value = selection
    voiceInputNote.hidden = true
  } catch (error) { voiceInputNote.hidden = false; voiceInputNote.textContent = `Could not list microphones: ${messageOf(error)}` }
}


function syncQualityControls(): void {
  const resolution = resolutionInput.value as ShareResolution
  for (const option of frameRateInput.options) {
    option.disabled = !supportsShareQuality({ resolution, frameRate: Number(option.value) as ShareFrameRate })
  }
  if (frameRateInput.selectedOptions[0]?.disabled) {
    frameRateInput.value = frameRateInput.querySelector<HTMLOptionElement>('option[value="60"]:not(:disabled)')?.value
      ?? frameRateInput.querySelector<HTMLOptionElement>('option:not(:disabled)')?.value
      ?? ''
  }
  const frameRate = Number(frameRateInput.value) as ShareFrameRate
  const bitrateMode = bitrateModeInput.value as ShareBitrateMode
  const priority = priorityInput.value as SharePriority
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
  frameRateInput.title = 'Frame rate'
  priorityInput.title = priority === 'framerate'
    ? 'Keeps the selected frame rate by reducing resolution when constrained'
    : 'Keeps image detail by allowing frames to be dropped when constrained'
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
  const value = Math.max(0, Math.min(200, Number(audioVolumeInput.value) || 0))
  audioVolumeInput.value = String(value)
  audioVolumeValue.value = `${value}%`
  audioVolumeValue.textContent = `${value}%`
  audioVolumeInput.title = `Global incoming audio volume: ${value}%`
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
  const resolution = resolutionInput.value as ShareResolution; const frameRate = Number(frameRateInput.value) as ShareFrameRate; const priority = priorityInput.value as SharePriority; const bitrateMode = bitrateModeInput.value as ShareBitrateMode; const bitrate = Number(bitrateInput.value)
  return { resolution, frameRate, priority, bitrateMode, bitrate }
}

function renderTelemetry(): void {
  if (joiningSession) return
  const hasMetrics = Boolean(telemetry.sent || telemetry.received)
  const focusView = currentRoom !== null && !gridView && selectedStreamId !== null
  streamMetrics.hidden = !hasMetrics || !showStatistics || !focusView
  renderMetricCard(hostMetrics, telemetry.sent, 'host')
  renderMetricCard(viewerMetrics, telemetry.received, 'viewer')
}

function renderMetricCard(card: HTMLElement, metric: StreamMetric | undefined, side: 'host' | 'viewer'): void {
  card.hidden = !metric
  if (!metric) return
  const quality = metric.width && metric.height ? `${metric.width} × ${metric.height}` : '—'
  const capture = metric.captureWidth && metric.captureHeight ? `${metric.captureWidth} × ${metric.captureHeight}${metric.captureFrameRate ? ` @ ${Math.round(metric.captureFrameRate)} fps` : ''}` : undefined
  const baseRows: Array<[string, string]> = [
    ['Encoded', quality],
    ...(capture ? [['Capture', capture] as [string, string]] : []),
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
    ? [
      ['Budget', formatBitrate(metric.maxBitrate)],
      ['Encoder target', formatBitrate(metric.targetBitrate)],
      ['GPU encode', gpuFeatureLabel(captureAccelerationStatus)],
      ['Limit', formatLimitation(metric)],
      ['RTT', formatMilliseconds(metric.roundTripTimeMs)],
    ]
    : [
      ['Codec', metric.codec ?? '—'],
      ['Decoder', metric.decoder ?? '—'],
      ['Dropped', metric.framesDropped === undefined ? '—' : formatCount(metric.framesDropped)],
      ['Buffer', formatMilliseconds(metric.jitterBufferDelayMs)],
      ['Decode', formatMilliseconds(metric.decodeTimeMs)],
    ]
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
function formatLimitation(metric: StreamMetric): string {
  if (!metric.qualityLimitationReason || metric.qualityLimitationReason === 'none') return 'None'
  const reason = metric.qualityLimitationReason === 'cpu' ? 'CPU / encoder' : metric.qualityLimitationReason
  return metric.qualityLimitationDurationMs === undefined ? reason : `${reason} · ${formatMilliseconds(metric.qualityLimitationDurationMs)}`
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
function readForm(): AppConfig { return { url: urlInput.value, apiKey: keyInput.value, apiSecret: secretInput.value, displayName: nameInput.value, showStreamStatistics: showStreamStatisticsInput.checked, checkForUpdatesOnStartup: checkForUpdatesOnStartupInput.checked, updateChannel: updateChannelInput.value === 'beta' ? 'beta' : 'stable', showChatBubbles: showChatBubblesInput.checked, voiceEnabled: voiceEnabledInput.checked, voiceInputDeviceId: voiceInput.value || 'default', voiceInputVolume: Number(voiceInputVolume.value) / 100 } }
function fillForm(config: AppConfig): void {
  savedConfig = config
  urlInput.value = config.url; keyInput.value = config.apiKey; secretInput.value = config.apiSecret; nameInput.value = config.displayName
  showStatistics = config.showStreamStatistics
  checkForUpdatesOnStartupInput.checked = config.checkForUpdatesOnStartup
  updateChannelInput.value = config.updateChannel === 'beta' ? 'beta' : 'stable'
  showStreamStatisticsInput.checked = showStatistics
  showChatBubblesInput.checked = config.showChatBubbles === true
  voiceEnabledInput.checked = config.voiceEnabled !== false
  const inputDeviceId = config.voiceInputDeviceId || 'default'
  if (![...voiceInput.options].some(option => option.value === inputDeviceId)) voiceInput.append(Object.assign(document.createElement('option'), { value: inputDeviceId, textContent: 'Saved microphone' }))
  voiceInput.value = inputDeviceId
  voiceInputVolume.value = String(Math.round((config.voiceInputVolume ?? 1) * 100))
  syncVoiceInputVolume()
  syncVoiceSettings()
  chat.configure(showChatBubblesInput.checked)
  elementById('profile-name').textContent = config.displayName || 'Name'
  elementById('profile-avatar').textContent = initials(config.displayName)
  elementById('profile-avatar').style.setProperty('--avatar-hue', String(avatarHue(config.displayName)))
}
function openSettings(): void {
  clearNote(settingsNote)
  selectSettingsTab('account')
  if (!settingsDialog.open) settingsDialog.showModal()
  void loadVoiceInputs()
}
function selectSettingsTab(name: string): void {
  settingsDialog.querySelectorAll<HTMLButtonElement>('[data-settings-tab]').forEach(tab => {
    const selected = tab.dataset.settingsTab === name
    tab.setAttribute('aria-selected', String(selected))
    tab.tabIndex = selected ? 0 : -1
    elementById(tab.getAttribute('aria-controls')!).hidden = !selected
    if (selected) elementById('settings-section-title').textContent = tab.textContent!.trim()
  })
}
function syncVoiceInputVolume(): void {
  const value = Math.max(0, Math.min(100, Number(voiceInputVolume.value)))
  voiceInputVolumeValue.value = `${value}%`
  setVoiceInputVolume(value / 100)
}
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
