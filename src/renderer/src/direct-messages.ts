import type { DirectMessage, Id } from '../../shared/protocol'
import { icon, labelButton } from './icons'

export const CHAT_MAX_LENGTH = 2_000

export interface ChatMessage {
  id: string
  text: string
  timestamp: number
  senderId: string
  senderName: string
  local: boolean
}

interface Conversation {
  id: string
  name: string
  messages: ChatMessage[]
  unread: number
  draft: string
  scrollTop: number
  atBottom: boolean
}

export interface DirectMessageHooks {
  send: (recipientId: Id, text: string, nonce: string) => Promise<DirectMessage>
  avatar: (name: string) => HTMLElement
  /** The signed-in user's ID. */
  self: () => Id | null
  /** The current display name of someone who shares a server with the user. */
  nameOf: (id: Id) => string | undefined
  /** The chat area shows a conversation (`true`) or the text channel (`false`). */
  onShow: (conversation: boolean) => void
  onUnread: () => void
}

const el = (id: string): HTMLElement => document.getElementById(id)!
const MAX_HISTORY = 500
const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
const day = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })

export function toChatMessage(message: DirectMessage, self: Id | null): ChatMessage {
  return {
    id: message.id,
    text: message.content,
    timestamp: Date.parse(message.created_at) || Date.now(),
    senderId: message.author.id,
    senderName: message.author.display_name,
    local: message.author.id === self,
  }
}

/**
 * Private messages. Each conversation is a tab next to the text channel at the top of the chat area.
 * The server only passes messages on, so conversations live in memory until the app closes or the user logs out.
 */
export class DirectMessages {
  private panel = el('chat-panel')
  private log = el('chat-messages')
  private tabs = el('chat-tabs')
  private channelTab = el('text-channel-tab') as HTMLButtonElement
  private input = el('chat-input') as HTMLTextAreaElement
  private send = el('chat-send') as HTMLButtonElement
  private error = el('chat-error')
  private jump = el('chat-jump') as HTMLButtonElement
  private bubbleHost = el('chat-bubbles')
  private conversations = new Map<string, Conversation>()
  /** The open conversation. `null` shows the text channel. */
  private active: string | null = null
  /** The chat area is on screen (not the voice stage). */
  private chatVisible = false
  private connected = false
  private bubbles = false
  private sending = false
  private bubbleTimers = new Map<HTMLElement, number>()

  constructor(private hooks: DirectMessageHooks) {
    this.channelTab.addEventListener('click', () => { if (this.active) { this.showChannel(); this.hooks.onShow(false) } })
    this.channelTab.addEventListener('keydown', event => this.tabKeys(event, null))
    el('chat-form').addEventListener('submit', event => { event.preventDefault(); void this.submit() })
    this.input.addEventListener('input', () => {
      const conversation = this.current()
      if (conversation) conversation.draft = this.input.value
      this.resizeInput(); this.syncComposer()
      this.error.hidden = true
    })
    this.input.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); void this.submit() }
    })
    this.log.addEventListener('scroll', () => {
      const conversation = this.current()
      if (!conversation) return
      conversation.scrollTop = this.log.scrollTop
      conversation.atBottom = this.atBottom()
      if (conversation.atBottom && this.isReading()) this.markRead()
      this.syncJump()
    })
    this.jump.addEventListener('click', () => this.scrollToBottom())
    window.addEventListener('focus', () => { if (this.isReading() && this.atBottom()) this.markRead() })
    document.addEventListener('visibilitychange', () => { if (this.isReading() && this.atBottom()) this.markRead() })
    new ResizeObserver(() => {
      if (this.isShown() && this.current()?.atBottom) this.log.scrollTop = this.log.scrollHeight
    }).observe(this.log)
    this.sync()
  }

  /** Whether the chat area is on screen. The voice stage hides it. */
  setChatVisible(visible: boolean): void {
    if (this.chatVisible === visible) return
    this.chatVisible = visible
    if (this.isShown()) {
      this.renderMessages()
      if (this.current()?.atBottom) this.scrollToBottom()
    }
  }

  setConnection(connected: boolean): void { this.connected = connected; this.syncComposer() }

  configure(bubbles: boolean): void {
    this.bubbles = bubbles
    if (!bubbles) this.clearBubbles()
  }

  /** Shows the text channel tab. Used when the user picks a text channel or a server. */
  showChannel(): void {
    if (!this.active) return
    this.saveScroll()
    this.active = null
    this.error.hidden = true
    this.sync()
  }

  /** Signing out forgets every conversation. */
  clear(): void {
    const wasOpen = this.active !== null
    this.conversations.clear()
    this.active = null
    this.sending = false
    this.input.value = ''
    this.error.hidden = true
    this.log.replaceChildren()
    this.clearBubbles(); this.sync(); this.hooks.onUnread()
    if (wasOpen) this.hooks.onShow(false)
  }

  unreadFor(id: string): number { return this.conversations.get(id)?.unread ?? 0 }

  /** Opens the conversation with this person in the chat area. */
  open(id: string): void {
    if (id === this.hooks.self()) return
    const name = this.hooks.nameOf(id)
    if (!this.conversations.has(id)) {
      if (!name) return
      this.conversations.set(id, this.conversation(id, name))
    }
    this.select(id)
    this.hooks.onShow(true)
    this.clearBubbles()
    this.scrollToBottom()
    this.input.focus()
  }

  receive(event: DirectMessage): void {
    const self = this.hooks.self()
    const message = toChatMessage(event, self)
    const id = message.local ? event.recipient_id : event.author.id
    if (id === self) return
    let conversation = this.conversations.get(id)
    if (!conversation) {
      conversation = this.conversation(id, this.hooks.nameOf(id) || message.senderName)
      this.conversations.set(id, conversation)
    }
    if (conversation.messages.some(existing => existing.id === message.id)) return
    if (!message.local) conversation.name = message.senderName
    const follows = this.isShown() && id === this.active && conversation.atBottom
    conversation.messages.push(message)
    if (conversation.messages.length > MAX_HISTORY) conversation.messages.shift()
    if (!message.local && !(id === this.active && this.isReading() && follows)) conversation.unread++
    if (id === this.active && this.isShown()) this.appendMessage(message, conversation.messages.at(-2))
    if (follows) this.scrollToBottom(false)
    this.sync(); this.hooks.onUnread()
    if (!message.local && this.bubbles && !(id === this.active && this.isShown())) this.showBubble(message, id)
  }

  private current(): Conversation | undefined { return this.active ? this.conversations.get(this.active) : undefined }
  private conversation(id: string, name: string): Conversation { return { id, name, messages: [], unread: 0, draft: '', scrollTop: 0, atBottom: true } }
  private atBottom(): boolean { return this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < 40 }
  private isShown(): boolean { return this.chatVisible && this.active !== null }
  private isReading(): boolean { return this.isShown() && document.visibilityState === 'visible' && document.hasFocus() }

  private saveScroll(): void {
    const previous = this.current()
    if (previous && this.isShown()) { previous.draft = this.input.value; previous.scrollTop = this.log.scrollTop }
  }

  private select(id: string): void {
    if (!this.conversations.has(id)) return
    this.saveScroll()
    this.active = id
    this.input.value = this.conversations.get(id)!.draft
    this.error.hidden = true
    this.resizeInput()
    this.sync()
    this.renderMessages()
    if (this.conversations.get(id)!.atBottom) this.scrollToBottom()
  }

  private markRead(): void {
    const conversation = this.current()
    if (!conversation?.unread) return
    conversation.unread = 0
    this.sync(); this.hooks.onUnread()
  }

  private scrollToBottom(mark = true): void {
    this.log.scrollTop = this.log.scrollHeight
    const conversation = this.current()
    if (conversation) { conversation.atBottom = true; conversation.scrollTop = this.log.scrollTop }
    if (mark && this.isReading()) this.markRead()
    this.syncJump()
  }

  private sync(): void {
    const open = this.active !== null
    this.panel.hidden = !open
    document.body.classList.toggle('view-private', open)
    this.channelTab.setAttribute('aria-selected', String(!open))
    this.channelTab.tabIndex = open ? -1 : 0
    this.renderTabs()
    this.syncComposer(); this.syncJump()
  }

  private syncComposer(): void {
    const conversation = this.current()
    const peerGone = Boolean(conversation) && !this.hooks.nameOf(conversation!.id)
    this.input.disabled = !conversation || !this.connected || peerGone || this.sending
    this.send.disabled = this.input.disabled || !this.input.value.trim()
    this.input.placeholder = !conversation ? '' : !this.connected ? 'Reconnecting…' : peerGone ? 'You no longer share a server with this person' : `Message @${conversation.name}`
    this.input.setAttribute('aria-label', this.input.placeholder || 'Message')
  }

  private syncJump(): void {
    const conversation = this.current()
    this.jump.hidden = !conversation || conversation.atBottom
    this.badge(this.jump.querySelector('.chat-badge')!, conversation?.unread ?? 0)
  }

  private badge(element: Element, count: number): void {
    (element as HTMLElement).hidden = count === 0
    element.textContent = count > 99 ? '+99' : String(count)
  }

  private tabKeys(event: KeyboardEvent, id: string | null): void {
    const ids: Array<string | null> = [null, ...this.conversations.keys()]
    let index = ids.indexOf(id)
    if (event.key === 'ArrowRight') index = (index + 1) % ids.length
    else if (event.key === 'ArrowLeft') index = (index - 1 + ids.length) % ids.length
    else if (event.key === 'Home') index = 0
    else if (event.key === 'End') index = ids.length - 1
    else return
    event.preventDefault()
    const next = ids[index]
    if (next) this.open(next)
    else this.channelTab.click()
    const target = next ? this.tabs.querySelector<HTMLButtonElement>(`[data-tab-id="${CSS.escape(next)}"]`) : this.channelTab
    target?.focus()
  }

  private renderTabs(): void {
    // Preserve focus and avoid rebuilding tabs when nothing changed.
    const signature = JSON.stringify([...this.conversations.values()].map(conversation => [conversation.id, conversation.name, conversation.unread, conversation.id === this.active]))
    if (this.tabs.dataset.signature === signature) return
    const focused = (document.activeElement as HTMLElement)?.dataset.tabId
    this.tabs.dataset.signature = signature
    this.tabs.replaceChildren()
    for (const conversation of this.conversations.values()) {
      const selected = conversation.id === this.active
      const item = Object.assign(document.createElement('div'), { className: `text-tab-item${selected ? ' is-active' : ''}` })
      const tab = Object.assign(document.createElement('button'), { type: 'button', className: 'text-tab' })
      tab.dataset.tabId = conversation.id
      tab.setAttribute('role', 'tab')
      tab.setAttribute('aria-selected', String(selected))
      tab.setAttribute('aria-controls', 'chat-panel')
      tab.tabIndex = selected ? 0 : -1
      tab.title = `Private messages with ${conversation.name}`
      tab.innerHTML = icon('private')
      tab.append(Object.assign(document.createElement('span'), { className: 'text-tab-name', textContent: conversation.name }))
      if (conversation.unread) { const badge = Object.assign(document.createElement('span'), { className: 'chat-badge' }); this.badge(badge, conversation.unread); tab.append(badge) }
      tab.addEventListener('click', () => this.open(conversation.id))
      tab.addEventListener('keydown', event => this.tabKeys(event, conversation.id))
      const close = Object.assign(document.createElement('button'), { type: 'button', className: 'text-tab-close' })
      labelButton(close, `Close the conversation with ${conversation.name}`); close.innerHTML = icon('close')
      close.addEventListener('click', () => {
        const wasActive = this.active === conversation.id
        this.conversations.delete(conversation.id)
        if (wasActive) { this.active = null; this.hooks.onShow(false) }
        this.sync(); this.hooks.onUnread()
        if (wasActive) this.channelTab.focus()
      })
      item.append(tab, close)
      this.tabs.append(item)
    }
    if (focused) this.tabs.querySelector<HTMLButtonElement>(`[data-tab-id="${CSS.escape(focused)}"]`)?.focus()
  }

  private renderMessages(): void {
    const conversation = this.current()
    this.log.replaceChildren()
    if (!conversation) { this.syncJump(); return }
    const start = Object.assign(document.createElement('p'), { className: 'text-start', textContent: `This is the start of your private messages with ${conversation.name}. They are not saved: they go away when zodiak closes.` })
    this.log.append(start)
    conversation.messages.forEach((message, index) => this.appendMessage(message, conversation.messages[index - 1]))
    this.log.scrollTop = conversation.atBottom ? this.log.scrollHeight : conversation.scrollTop
    this.syncJump()
  }

  private appendMessage(message: ChatMessage, previous?: ChatMessage): void {
    const newDay = !previous || new Date(previous.timestamp).toDateString() !== new Date(message.timestamp).toDateString()
    if (newDay) this.log.append(Object.assign(document.createElement('div'), { className: 'chat-day', textContent: day.format(message.timestamp) }))
    const grouped = !newDay && previous?.senderId === message.senderId && previous.senderName === message.senderName && message.timestamp >= previous.timestamp && message.timestamp - previous.timestamp < 300_000
    let group = grouped ? this.log.lastElementChild as HTMLElement : null
    if (!group || !group.classList.contains('chat-message-group')) {
      group = document.createElement('article'); group.className = 'chat-message-group'
      const avatar = this.hooks.avatar(message.senderName); avatar.classList.add('chat-avatar')
      const body = document.createElement('div'); body.className = 'chat-message-body'
      const head = document.createElement('header'); head.className = 'chat-message-head'
      const name = Object.assign(document.createElement('span'), { className: 'chat-sender', textContent: message.senderName })
      const timestamp = Object.assign(document.createElement('time'), { textContent: time.format(message.timestamp), dateTime: new Date(message.timestamp).toISOString(), title: new Date(message.timestamp).toLocaleString() })
      head.append(name, timestamp); body.append(head); group.append(avatar, body); this.log.append(group)
    }
    const content = document.createElement('div'); content.className = 'chat-message-text'; content.dataset.messageId = message.id
    content.title = new Date(message.timestamp).toLocaleString()
    renderText(content, message.text, () => { if (this.current()?.atBottom) this.log.scrollTop = this.log.scrollHeight })
    group.querySelector('.chat-message-body')!.append(content)
    const messages = this.log.querySelectorAll('.chat-message-text')
    if (messages.length > MAX_HISTORY) {
      const first = messages[0]; const parent = first.closest('.chat-message-group')!
      first.remove()
      if (!parent.querySelector('.chat-message-text')) { if (parent.previousElementSibling?.classList.contains('chat-day')) parent.previousElementSibling.remove(); parent.remove() }
    }
  }

  private resizeInput(): void { this.input.style.height = 'auto'; this.input.style.height = `${Math.min(200, this.input.scrollHeight)}px` }

  private async submit(): Promise<void> {
    const text = this.input.value.trim()
    const conversation = this.current()
    if (!text || !conversation || this.sending || this.input.disabled) return
    if (text.length > CHAT_MAX_LENGTH) { this.error.textContent = `Maximum ${CHAT_MAX_LENGTH} characters.`; this.error.hidden = false; return }
    this.sending = true; this.error.hidden = true; this.syncComposer()
    try {
      const message = await this.hooks.send(conversation.id, text, crypto.randomUUID())
      conversation.draft = ''
      if (conversation.id === this.active) { this.input.value = ''; this.resizeInput() }
      this.receive(message)
      if (conversation.id === this.active) this.scrollToBottom()
    } catch (error) {
      this.error.textContent = error instanceof Error ? error.message : 'Could not send. Try again.'; this.error.hidden = false
    } finally {
      this.sending = false; this.syncComposer(); if (this.isShown()) this.input.focus()
    }
  }

  private showBubble(message: ChatMessage, id: string): void {
    while (this.bubbleHost.children.length >= 2) this.removeBubble(this.bubbleHost.firstElementChild as HTMLElement)
    const bubble = Object.assign(document.createElement('button'), { type: 'button', className: 'chat-bubble' })
    const copy = document.createElement('span'); copy.className = 'chat-bubble-copy'
    const heading = Object.assign(document.createElement('strong'), { textContent: message.senderName })
    const lock = document.createElement('span'); lock.innerHTML = icon('private'); heading.append(lock)
    copy.append(heading, Object.assign(document.createElement('span'), { textContent: message.text }))
    bubble.append(this.hooks.avatar(message.senderName), copy)
    labelButton(bubble, `Open private messages from ${message.senderName}`)
    bubble.addEventListener('click', () => this.open(id))
    this.bubbleHost.append(bubble)
    this.bubbleTimers.set(bubble, window.setTimeout(() => this.removeBubble(bubble), 5_000))
  }

  private removeBubble(bubble: HTMLElement): void { window.clearTimeout(this.bubbleTimers.get(bubble)); this.bubbleTimers.delete(bubble); bubble.remove() }
  private clearBubbles(): void { for (const bubble of this.bubbleTimers.keys()) this.removeBubble(bubble) }
}

function safeUrl(raw: string): URL | null {
  try { const url = new URL(/^www\./i.test(raw) ? `https://${raw}` : raw); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url : null } catch { return null }
}

/** Plain text with clickable links. Video links load a player on click. */
function renderText(target: HTMLElement, text: string, onLoad: () => void): void {
  const urls: URL[] = []; let cursor = 0
  for (const match of text.matchAll(/(?:https?:\/\/|www\.)[^\s<>]+/gi)) {
    let raw = match[0].replace(/[.,!?;:]+$/, '')
    // Strip prose delimiters, retaining balanced parentheses in URLs.
    while (raw.endsWith(')') && (raw.match(/\)/g)?.length ?? 0) > (raw.match(/\(/g)?.length ?? 0)) raw = raw.slice(0, -1)
    raw = raw.replace(/[\]}]+$/, '')
    const url = safeUrl(raw)
    target.append(document.createTextNode(text.slice(cursor, match.index)))
    if (url) {
      target.append(Object.assign(document.createElement('a'), { href: url.href, textContent: raw, target: '_blank', rel: 'noopener noreferrer' }))
      if (!urls.some(existing => existing.href === url.href)) urls.push(url)
    } else target.append(document.createTextNode(raw))
    cursor = match.index + raw.length
  }
  target.append(document.createTextNode(text.slice(cursor)))
  for (const url of urls.slice(0, 2)) {
    let videoId: string | null = null
    if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname)) videoId = url.searchParams.get('v') || url.pathname.match(/^\/(?:shorts|embed)\/([\w-]+)/)?.[1] || null
    if (url.hostname === 'youtu.be') videoId = url.pathname.slice(1)
    const video = url.protocol === 'https:' && /\.(mp4|webm)$/i.test(url.pathname)
    if ((videoId && /^[\w-]{11}$/.test(videoId)) || video) {
      const preview = Object.assign(document.createElement('button'), { type: 'button', className: 'chat-embed-preview' })
      preview.innerHTML = icon('play'); preview.append(document.createTextNode(url.hostname))
      labelButton(preview, `Load video from ${url.hostname}`)
      preview.addEventListener('click', () => {
        if (video) {
          const player = Object.assign(document.createElement('video'), { src: url.href, controls: true, preload: 'metadata', className: 'chat-embed' })
          player.addEventListener('loadedmetadata', onLoad); preview.replaceWith(player)
        } else {
          const frame = Object.assign(document.createElement('iframe'), { src: `https://www.youtube-nocookie.com/embed/${videoId}`, title: 'Shared YouTube video', className: 'chat-embed', referrerPolicy: 'no-referrer' })
          frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation'); frame.allow = 'fullscreen; picture-in-picture'; frame.allowFullscreen = true
          frame.addEventListener('load', onLoad); preview.replaceWith(frame)
        }
        onLoad()
      })
      target.append(preview)
    }
  }
}
