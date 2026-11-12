import type { Channel, ChannelKind, GuildSnapshot, Invite, Id, User } from '../../../shared/protocol'
import type { GatewayState } from '../../../shared/zodiak'
import { icon, labelButton } from '../icons'
import { api, errorText } from './api'
import { ZodiakStore } from './store'
import { TextChannelView } from './text-view'

export interface VoiceBridge {
  /** The voice channel the user is connected to, if any. */
  currentVoiceChannel: () => Id | null
  joinVoice: (channel: Channel) => Promise<void>
  leaveVoice: () => Promise<void>
  /** The layout changed (server, channel or view). Re-render the rest of the app. */
  layoutChanged: () => void
  /** The account (or its display name) changed. */
  userChanged: (user: User | null) => void
}

type View = 'text' | 'voice'
const INVITE_LIFETIME_SECONDS = 7 * 24 * 60 * 60
const SELECTION_KEY = 'zodiak.selection'

function el<T extends HTMLElement>(id: string, type: new () => T): T {
  const element = document.getElementById(id)
  if (!(element instanceof type)) throw new Error(`Missing #${id}`)
  return element
}

function showNote(note: HTMLElement, message: string, tone: 'error' | 'info' = 'error'): void {
  note.textContent = message
  note.dataset.tone = tone
  note.hidden = false
}

function clearNote(note: HTMLElement): void {
  note.hidden = true
  note.textContent = ''
}

/** Initials for a server button: up to two characters. */
export function guildInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const initials = words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? '?').slice(0, 2)
  return [...initials].slice(0, 2).join('').toUpperCase()
}

/** Accepts a bare invite code or a pasted text that contains one. */
export function parseInviteCode(value: string): string | null {
  const match = value.trim().match(/([A-Za-z0-9]{10})\s*$/)
  return match ? match[1] : null
}

export class ZodiakUi {
  readonly store = new ZodiakStore()
  private guildId: Id | null = null
  private textChannelId: Id | null = null
  private view: View = 'text'
  private joiningVoice: Id | null = null
  private gatewayState: GatewayState = 'offline'
  private signedIn = false
  private authMode: 'login' | 'register' = 'login'
  private readonly text: TextChannelView
  private channelDialogTarget: { guildId: Id; channel?: Channel } | null = null
  private confirmAction: (() => Promise<void>) | null = null

  private readonly rail = el('room-list', HTMLDivElement)
  private readonly channelList = el('channel-list', HTMLElement)
  private readonly guildName = el('guild-name', HTMLHeadingElement)
  private readonly banner = el('connection-banner', HTMLParagraphElement)

  constructor(private readonly bridge: VoiceBridge) {
    this.text = new TextChannelView(this.store, (title, message, action, run) => this.confirm(title, message, action, run))
    this.restoreSelection()
    this.store.subscribe((change) => {
      if (change.kind === 'messages') return
      this.reconcileSelection()
      this.render()
      if (change.kind === 'all' || this.store.user) bridge.userChanged(this.store.user)
      bridge.layoutChanged()
    })
    window.zodiak.onEvent((event) => this.store.apply(event))
    window.zodiak.onGatewayState((state) => {
      this.gatewayState = state
      this.banner.hidden = !this.signedIn || state === 'ready'
      this.banner.textContent = state === 'connecting' ? 'Connecting…' : 'Offline'
    })
    window.zodiak.onSignedOut(() => void this.signedOut('You were logged out.'))
    this.bind()
  }

  // ---- Public state for main.ts ----

  hasGuild(): boolean {
    return this.signedIn && this.store.guild(this.guildId) !== undefined
  }

  isTextView(): boolean {
    return this.hasGuild() && this.view === 'text' && this.textChannelId !== null
  }

  channelName(id: Id | null): string | undefined {
    return this.store.channel(id)?.name
  }

  user(): User | null {
    return this.store.user
  }

  async start(): Promise<void> {
    const session = await window.zodiak.session()
    if (session.state === 'signed-in') this.signIn(session.user)
    else if (session.state === 'offline') this.showOffline(session.error)
    else this.showAuth()
  }

  async updateDisplayName(name: string): Promise<User> {
    const user = await api<User>('PATCH', '/v1/users/@me', { display_name: name })
    this.store.apply({ t: 'USER_UPDATE', d: user })
    return user
  }

  async logout(everywhere: boolean): Promise<void> {
    await window.zodiak.logout(everywhere)
    await this.signedOut(null)
  }

  /** Called when a voice connection starts or ends. */
  voiceChanged(): void {
    if (!this.bridge.currentVoiceChannel() && !this.joiningVoice && this.view === 'voice') this.view = 'text'
    this.render()
  }

  // ---- Session ----

  private signIn(user: User): void {
    this.signedIn = true
    this.store.user = user
    document.body.classList.remove('signed-out')
    el('auth-screen', HTMLElement).hidden = true
    el('account-username', HTMLParagraphElement).textContent = `Username: ${user.username}`
    this.bridge.userChanged(user)
    this.render()
    this.bridge.layoutChanged()
  }

  private async signedOut(message: string | null): Promise<void> {
    if (!this.signedIn) return
    this.signedIn = false
    await this.bridge.leaveVoice().catch(() => undefined)
    for (const dialog of document.querySelectorAll<HTMLDialogElement>('dialog[open]')) dialog.close()
    this.store.reset()
    this.text.close()
    this.bridge.userChanged(null)
    this.showAuth()
    if (message) showNote(el('auth-note', HTMLParagraphElement), message, 'info')
    this.bridge.layoutChanged()
  }

  private showAuth(): void {
    document.body.classList.add('signed-out')
    el('auth-screen', HTMLElement).hidden = false
    el('auth-form', HTMLFormElement).hidden = false
    el('auth-offline', HTMLDivElement).hidden = true
    this.setAuthMode(this.authMode)
    el('auth-username', HTMLInputElement).focus()
  }

  private showOffline(message: string): void {
    document.body.classList.add('signed-out')
    el('auth-screen', HTMLElement).hidden = false
    el('auth-form', HTMLFormElement).hidden = true
    el('auth-offline', HTMLDivElement).hidden = false
    el('auth-offline-message', HTMLParagraphElement).textContent = message
  }

  private setAuthMode(mode: 'login' | 'register'): void {
    this.authMode = mode
    const register = mode === 'register'
    el('auth-tab-login', HTMLButtonElement).setAttribute('aria-selected', String(!register))
    el('auth-tab-register', HTMLButtonElement).setAttribute('aria-selected', String(register))
    el('auth-display-name-field', HTMLLabelElement).hidden = !register
    el('auth-hint', HTMLParagraphElement).hidden = !register
    el('auth-password', HTMLInputElement).autocomplete = register ? 'new-password' : 'current-password'
    el('auth-submit', HTMLButtonElement).textContent = register ? 'Create account' : 'Log in'
    clearNote(el('auth-note', HTMLParagraphElement))
  }

  private async submitAuth(): Promise<void> {
    const note = el('auth-note', HTMLParagraphElement)
    const submit = el('auth-submit', HTMLButtonElement)
    const username = el('auth-username', HTMLInputElement).value.trim()
    const password = el('auth-password', HTMLInputElement)
    const displayName = el('auth-display-name', HTMLInputElement).value.trim()
    if (!username || !password.value) return showNote(note, 'Enter your username and password.')
    clearNote(note)
    submit.disabled = true
    try {
      const result = this.authMode === 'register'
        ? await window.zodiak.register({ username, password: password.value, ...(displayName ? { display_name: displayName } : {}) })
        : await window.zodiak.login({ username, password: password.value })
      if (!result.ok) {
        const wait = result.retryAfterMs ? ` Try again in ${Math.ceil(result.retryAfterMs / 1000)} s.` : ''
        showNote(note, `${result.error}${wait}`)
        return
      }
      password.value = ''
      this.signIn(result.value)
    } finally {
      submit.disabled = false
    }
  }

  // ---- Selection ----

  private restoreSelection(): void {
    try {
      const saved = JSON.parse(localStorage.getItem(SELECTION_KEY) ?? '{}') as { guildId?: string; channels?: Record<string, string> }
      this.guildId = typeof saved.guildId === 'string' ? saved.guildId : null
    } catch { this.guildId = null }
  }

  private lastChannels(): Record<string, string> {
    try {
      const saved = JSON.parse(localStorage.getItem(SELECTION_KEY) ?? '{}') as { channels?: Record<string, string> }
      return saved.channels && typeof saved.channels === 'object' ? saved.channels : {}
    } catch { return {} }
  }

  private saveSelection(): void {
    const channels = this.lastChannels()
    if (this.guildId && this.textChannelId) channels[this.guildId] = this.textChannelId
    localStorage.setItem(SELECTION_KEY, JSON.stringify({ guildId: this.guildId, channels }))
  }

  /** Keeps the selection valid after servers or channels change. */
  private reconcileSelection(): void {
    const guilds = this.store.guilds
    if (!this.store.guild(this.guildId)) this.guildId = guilds[0]?.guild.id ?? null
    const snapshot = this.store.guild(this.guildId)
    const textChannels = snapshot?.channels.filter((c) => c.kind === 'text') ?? []
    if (!textChannels.some((c) => c.id === this.textChannelId)) {
      const remembered = this.guildId ? this.lastChannels()[this.guildId] : undefined
      this.textChannelId = textChannels.find((c) => c.id === remembered)?.id ?? textChannels[0]?.id ?? null
    }
    const voice = this.bridge.currentVoiceChannel()
    if (voice && !this.store.channel(voice)) void this.bridge.leaveVoice()
    if (this.view === 'voice' && !voice && !this.joiningVoice) this.view = 'text'
    this.text.open(this.isTextView() ? this.textChannelId : null)
  }

  private selectGuild(guildId: Id): void {
    if (this.guildId === guildId) return
    this.guildId = guildId
    this.textChannelId = null
    const voice = this.store.channel(this.bridge.currentVoiceChannel())
    this.view = voice?.guild_id === guildId ? 'voice' : 'text'
    this.reconcileSelection()
    this.saveSelection()
    this.render()
    this.bridge.layoutChanged()
  }

  private async selectChannel(channel: Channel): Promise<void> {
    if (channel.kind === 'text') {
      this.textChannelId = channel.id
      this.view = 'text'
      this.saveSelection()
    } else if (this.bridge.currentVoiceChannel() === channel.id) {
      this.view = 'voice'
    } else {
      this.view = 'voice'
      this.joiningVoice = channel.id
      this.render()
      this.bridge.layoutChanged()
      try { await this.bridge.joinVoice(channel) } finally { this.joiningVoice = null }
      if (this.bridge.currentVoiceChannel() !== channel.id) this.view = 'text'
    }
    this.text.open(this.isTextView() ? this.textChannelId : null)
    this.render()
    this.bridge.layoutChanged()
  }

  // ---- Rendering ----

  render(): void {
    document.body.classList.toggle('has-guild', this.hasGuild())
    document.body.classList.toggle('view-text', this.isTextView())
    this.banner.hidden = !this.signedIn || this.gatewayState === 'ready'
    this.renderRail()
    this.renderSidebar()
  }

  private renderRail(): void {
    this.rail.replaceChildren()
    if (!this.signedIn) return
    const voiceGuild = this.store.channel(this.bridge.currentVoiceChannel())?.guild_id
    for (const { guild } of this.store.guilds) {
      const row = Object.assign(document.createElement('div'), { className: 'room-row' })
      const button = Object.assign(document.createElement('button'), { type: 'button', className: 'room', textContent: guildInitials(guild.name) })
      const active = guild.id === this.guildId
      button.classList.toggle('is-active', active)
      button.setAttribute('aria-pressed', String(active))
      labelButton(button, guild.name)
      if (guild.id === voiceGuild) button.append(Object.assign(document.createElement('i'), { className: 'live-dot', ariaLabel: 'Connected to voice' }))
      button.addEventListener('click', () => this.selectGuild(guild.id))
      row.append(button)
      this.rail.append(row)
    }
  }

  private renderSidebar(): void {
    const snapshot = this.store.guild(this.guildId)
    this.channelList.replaceChildren()
    el('guild-header', HTMLElement).hidden = !snapshot
    if (!snapshot) return
    this.guildName.textContent = snapshot.guild.name
    this.guildName.title = snapshot.guild.name
    const owner = this.store.isOwner(snapshot.guild.id)
    for (const kind of ['text', 'voice'] as ChannelKind[]) {
      const channels = snapshot.channels.filter((c) => c.kind === kind)
      const heading = Object.assign(document.createElement('div'), { className: 'section-heading channel-heading' })
      heading.append(Object.assign(document.createElement('span'), { textContent: kind === 'text' ? 'Text channels' : 'Voice channels' }))
      if (owner) {
        const add = Object.assign(document.createElement('button'), { type: 'button', className: 'icon-button', innerHTML: icon('plus') })
        labelButton(add, kind === 'text' ? 'Create text channel' : 'Create voice channel')
        add.addEventListener('click', () => this.openChannelDialog(snapshot, undefined, kind))
        heading.append(add)
      }
      this.channelList.append(heading)
      for (const channel of channels) {
        this.channelList.append(this.channelRow(snapshot, channel, owner))
        if (channel.kind === 'voice') this.voiceMembers(snapshot, channel)
      }
    }
  }

  /** The people connected to a voice channel, under its row. */
  private voiceMembers(snapshot: GuildSnapshot, channel: Channel): void {
    const state = this.store.voice.get(channel.id)
    if (!state?.participants.length) return
    const list = Object.assign(document.createElement('ul'), { className: 'voice-members' })
    list.setAttribute('aria-label', `In ${channel.name}`)
    for (const participant of state.participants) {
      const item = document.createElement('li')
      const name = this.store.memberName(snapshot.guild.id, participant.user_id) ?? 'Unknown'
      const avatar = Object.assign(document.createElement('span'), { className: 'avatar voice-member-avatar', textContent: [...name][0]?.toUpperCase() ?? '?' })
      item.append(avatar, Object.assign(document.createElement('span'), { className: 'voice-member-name', textContent: name }))
      if (participant.streaming) item.append(Object.assign(document.createElement('span'), { className: 'member-live', textContent: 'LIVE' }))
      if (participant.deafened || participant.muted) {
        const status = Object.assign(document.createElement('span'), { className: 'voice-member-status', innerHTML: icon(participant.deafened ? 'headphones-off' : 'mic-off') })
        status.title = participant.deafened ? `${name} is deafened` : `${name} is muted`
        item.append(status)
      }
      list.append(item)
    }
    this.channelList.append(list)
  }

  private channelRow(snapshot: GuildSnapshot, channel: Channel, owner: boolean): HTMLElement {
    const row = Object.assign(document.createElement('div'), { className: 'channel-row' })
    const connected = this.bridge.currentVoiceChannel() === channel.id
    const selected = channel.kind === 'text' ? this.isTextView() && channel.id === this.textChannelId : connected && this.view === 'voice'
    const button = Object.assign(document.createElement('button'), { type: 'button', className: 'channel' })
    button.classList.toggle('is-active', selected)
    button.classList.toggle('is-connected', connected)
    button.setAttribute('aria-current', String(selected))
    button.innerHTML = icon(channel.kind === 'text' ? 'hash' : 'volume')
    button.append(Object.assign(document.createElement('span'), { className: 'channel-name', textContent: channel.name }))
    button.title = channel.kind === 'voice' && !connected ? `Join ${channel.name}` : channel.name
    button.addEventListener('click', () => void this.selectChannel(channel))
    row.append(button)
    if (owner) {
      const edit = Object.assign(document.createElement('button'), { type: 'button', className: 'icon-button channel-edit', innerHTML: icon('edit') })
      labelButton(edit, `Edit ${channel.name}`)
      edit.addEventListener('click', () => this.openChannelDialog(snapshot, channel))
      row.append(edit)
    }
    return row
  }

  // ---- Dialogs ----

  private bind(): void {
    el('auth-form', HTMLFormElement).addEventListener('submit', (event) => { event.preventDefault(); void this.submitAuth() })
    for (const tab of document.querySelectorAll<HTMLButtonElement>('[data-auth-mode]')) {
      tab.addEventListener('click', () => this.setAuthMode(tab.dataset.authMode === 'register' ? 'register' : 'login'))
    }
    el('auth-retry', HTMLButtonElement).addEventListener('click', () => void this.start())

    el('create-room-action', HTMLButtonElement).addEventListener('click', () => {
      clearNote(el('guild-dialog-note', HTMLParagraphElement))
      el('guild-dialog', HTMLDialogElement).showModal()
      el('guild-create-name', HTMLInputElement).focus()
    })
    el('guild-create-form', HTMLFormElement).addEventListener('submit', (event) => { event.preventDefault(); void this.createGuild() })
    el('guild-join-form', HTMLFormElement).addEventListener('submit', (event) => { event.preventDefault(); void this.joinGuild() })

    el('guild-invite', HTMLButtonElement).addEventListener('click', () => void this.createInvite())
    el('invite-copy', HTMLButtonElement).addEventListener('click', () => {
      const code = el('invite-code', HTMLInputElement).value
      void navigator.clipboard.writeText(code).then(
        () => showNote(el('invite-note', HTMLParagraphElement), 'Copied.', 'info'),
        () => showNote(el('invite-note', HTMLParagraphElement), 'Could not copy. Select the code and copy it.'),
      )
    })

    el('guild-settings', HTMLButtonElement).addEventListener('click', () => this.openGuildSettings())
    el('guild-settings-form', HTMLFormElement).addEventListener('submit', (event) => { event.preventDefault(); void this.renameGuild() })
    el('guild-add-channel', HTMLButtonElement).addEventListener('click', () => {
      const snapshot = this.store.guild(this.guildId)
      el('guild-settings-dialog', HTMLDialogElement).close()
      if (snapshot) this.openChannelDialog(snapshot, undefined, 'text')
    })
    el('guild-delete', HTMLButtonElement).addEventListener('click', () => {
      const snapshot = this.store.guild(this.guildId)
      if (!snapshot) return
      el('guild-settings-dialog', HTMLDialogElement).close()
      this.confirm('Delete server', `Delete “${snapshot.guild.name}”? All channels and messages are lost.`, 'Delete', async () => {
        await api('DELETE', `/v1/guilds/${snapshot.guild.id}`)
      })
    })
    el('guild-leave', HTMLButtonElement).addEventListener('click', () => {
      const snapshot = this.store.guild(this.guildId)
      if (!snapshot) return
      el('guild-settings-dialog', HTMLDialogElement).close()
      this.confirm('Leave server', `Leave “${snapshot.guild.name}”? You need a new invite to join again.`, 'Leave', async () => {
        await api('DELETE', `/v1/guilds/${snapshot.guild.id}/members/@me`)
      })
    })

    el('channel-form', HTMLFormElement).addEventListener('submit', (event) => { event.preventDefault(); void this.saveChannel() })
    el('channel-delete', HTMLButtonElement).addEventListener('click', () => {
      const channel = this.channelDialogTarget?.channel
      if (!channel) return
      el('channel-dialog', HTMLDialogElement).close()
      this.confirm('Delete channel', `Delete “${channel.name}”?${channel.kind === 'text' ? ' All its messages are lost.' : ''}`, 'Delete', async () => {
        await api('DELETE', `/v1/channels/${channel.id}`)
      })
    })

    el('confirm-action', HTMLButtonElement).addEventListener('click', () => void this.runConfirm())
    el('confirm-dialog', HTMLDialogElement).addEventListener('close', () => { this.confirmAction = null })

    el('logout', HTMLButtonElement).addEventListener('click', () => void this.logout(false))
    el('logout-all', HTMLButtonElement).addEventListener('click', () => {
      el('settings-dialog', HTMLDialogElement).close()
      this.confirm('Log out on all devices', 'End every session of your account, on every computer?', 'Log out', () => this.logout(true))
    })
  }

  private async createGuild(): Promise<void> {
    const input = el('guild-create-name', HTMLInputElement)
    const note = el('guild-dialog-note', HTMLParagraphElement)
    const name = input.value.trim()
    if (!name) return showNote(note, 'Enter a server name.')
    try {
      const snapshot = await api<GuildSnapshot>('POST', '/v1/guilds', { name })
      this.store.apply({ t: 'GUILD_CREATE', d: snapshot })
      input.value = ''
      el('guild-dialog', HTMLDialogElement).close()
      this.selectGuild(snapshot.guild.id)
    } catch (error) { showNote(note, errorText(error)) }
  }

  private async joinGuild(): Promise<void> {
    const input = el('guild-join-code', HTMLInputElement)
    const note = el('guild-dialog-note', HTMLParagraphElement)
    const code = parseInviteCode(input.value)
    if (!code) return showNote(note, 'An invite code has 10 letters and numbers.')
    try {
      const snapshot = await api<GuildSnapshot>('POST', `/v1/invites/${code}`)
      this.store.apply({ t: 'GUILD_CREATE', d: snapshot })
      input.value = ''
      el('guild-dialog', HTMLDialogElement).close()
      this.selectGuild(snapshot.guild.id)
    } catch (error) {
      showNote(note, (error as { status?: number }).status === 404 ? 'This invite is not valid or has expired.' : errorText(error))
    }
  }

  private async createInvite(): Promise<void> {
    if (!this.guildId) return
    const dialog = el('invite-dialog', HTMLDialogElement)
    const code = el('invite-code', HTMLInputElement)
    const note = el('invite-note', HTMLParagraphElement)
    code.value = ''
    clearNote(note)
    dialog.showModal()
    try {
      const invite = await api<Invite>('POST', `/v1/guilds/${this.guildId}/invites`, { expires_in_seconds: INVITE_LIFETIME_SECONDS })
      code.value = invite.code
      code.select()
    } catch (error) { showNote(note, errorText(error)) }
  }

  private openGuildSettings(): void {
    const snapshot = this.store.guild(this.guildId)
    if (!snapshot) return
    const owner = this.store.isOwner(snapshot.guild.id)
    el('guild-owner-settings', HTMLDivElement).hidden = !owner
    el('guild-delete', HTMLButtonElement).hidden = !owner
    el('guild-leave', HTMLButtonElement).hidden = owner
    el('guild-rename', HTMLInputElement).value = snapshot.guild.name
    clearNote(el('guild-settings-note', HTMLParagraphElement))
    el('guild-settings-dialog', HTMLDialogElement).showModal()
  }

  private async renameGuild(): Promise<void> {
    if (!this.guildId) return
    const name = el('guild-rename', HTMLInputElement).value.trim()
    const note = el('guild-settings-note', HTMLParagraphElement)
    if (!name) return showNote(note, 'Enter a server name.')
    try {
      await api('PATCH', `/v1/guilds/${this.guildId}`, { name })
      el('guild-settings-dialog', HTMLDialogElement).close()
    } catch (error) { showNote(note, errorText(error)) }
  }

  private openChannelDialog(snapshot: GuildSnapshot, channel?: Channel, kind: ChannelKind = 'text'): void {
    this.channelDialogTarget = { guildId: snapshot.guild.id, channel }
    el('channel-dialog-title', HTMLHeadingElement).textContent = channel ? 'Edit channel' : 'Create channel'
    el('channel-name', HTMLInputElement).value = channel?.name ?? ''
    el('channel-kind', HTMLSelectElement).value = channel?.kind ?? kind
    el('channel-kind-field', HTMLLabelElement).hidden = Boolean(channel)
    el('channel-delete', HTMLButtonElement).hidden = !channel
    el('channel-save', HTMLButtonElement).textContent = channel ? 'Save' : 'Create'
    clearNote(el('channel-note', HTMLParagraphElement))
    el('channel-dialog', HTMLDialogElement).showModal()
    el('channel-name', HTMLInputElement).focus()
  }

  private async saveChannel(): Promise<void> {
    const target = this.channelDialogTarget
    if (!target) return
    const note = el('channel-note', HTMLParagraphElement)
    const name = el('channel-name', HTMLInputElement).value.trim()
    if (!name) return showNote(note, 'Enter a channel name.')
    try {
      if (target.channel) {
        await api('PATCH', `/v1/channels/${target.channel.id}`, { name })
      } else {
        const kind = el('channel-kind', HTMLSelectElement).value === 'voice' ? 'voice' : 'text'
        const channel = await api<Channel>('POST', `/v1/guilds/${target.guildId}/channels`, { name, kind })
        this.store.apply({ t: 'CHANNEL_CREATE', d: channel })
        if (channel.kind === 'text') await this.selectChannel(channel)
      }
      el('channel-dialog', HTMLDialogElement).close()
    } catch (error) { showNote(note, errorText(error)) }
  }

  private confirm(title: string, message: string, action: string, run: () => Promise<void>): void {
    el('confirm-title', HTMLHeadingElement).textContent = title
    el('confirm-message', HTMLParagraphElement).textContent = message
    el('confirm-action', HTMLButtonElement).textContent = action
    clearNote(el('confirm-note', HTMLParagraphElement))
    this.confirmAction = run
    el('confirm-dialog', HTMLDialogElement).showModal()
  }

  private async runConfirm(): Promise<void> {
    const run = this.confirmAction
    if (!run) return
    const button = el('confirm-action', HTMLButtonElement)
    button.disabled = true
    try {
      await run()
      el('confirm-dialog', HTMLDialogElement).close()
    } catch (error) {
      showNote(el('confirm-note', HTMLParagraphElement), errorText(error))
    } finally { button.disabled = false }
  }
}
