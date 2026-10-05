import { CHAT_MAX_LENGTH, CHAT_IMAGE_ACCEPT, CHAT_IMAGE_MAX_COUNT, CHAT_IMAGE_BATCH_MAX_BYTES, validateChatImage, type ChatMessage, type ChatImage } from '../../shared/chat'
import { icon, labelButton } from './icons'
import type { RoomParticipant } from './session'

type ImageTarget = ChatImage | { url: string; name: string }

interface Conversation {
  id: string
  name: string
  messages: ChatMessage[]
  unread: number
  draft: string
  scrollTop: number
  atBottom: boolean
  images: File[]
  imageRevision: number
  preparing: boolean
}

interface RoomHistory {
  conversations: Map<string, Conversation>
  active: string
}

const el = (id: string): HTMLElement => document.getElementById(id)!
const MAX_HISTORY = 500
const MAX_IMAGE_HISTORY_BYTES = CHAT_IMAGE_BATCH_MAX_BYTES
const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
const day = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })

export class RoomChat {
  private panel = el('chat-panel')
  private log = el('chat-messages')
  private tabs = el('chat-tabs')
  private input = el('chat-input') as HTMLTextAreaElement
  private send = el('chat-send') as HTMLButtonElement
  private attach = el('chat-attach') as HTMLButtonElement
  private file = el('chat-file') as HTMLInputElement
  private attachment = el('chat-attachment')
  private attachmentUrls = new Set<string>()
  private imageUrls = new Set<string>()
  private imageDialog = el('chat-image-dialog') as HTMLDialogElement
  private fullImage = el('chat-image-full') as HTMLImageElement
  private imagePrevious = el('chat-image-previous') as HTMLButtonElement
  private imageNext = el('chat-image-next') as HTMLButtonElement
  private imageSequence = el('chat-image-sequence')
  private viewerImages: { url: string; name: string }[] = []
  private viewerUrls = new Set<string>()
  private viewerIndex = 0
  private fileTarget: { conversation: Conversation; generation: number } | null = null
  private error = el('chat-error')
  private jump = el('chat-jump') as HTMLButtonElement
  private bubbleHost = el('chat-bubbles')
  private conversations = new Map<string, Conversation>()
  // Renderer memory only: no local storage, files, or server history.
  private histories = new Map<string, RoomHistory>()
  private historyKey: string | null = null
  private server = ''
  private participants: RoomParticipant[] = []
  private active = 'room'
  private roomName: string | null = null
  private visible = true
  private connected = false
  private bubbles = false
  private sending = false
  private generation = 0
  private bubbleTimers = new Map<HTMLElement, number>()
  private observer: ResizeObserver

  constructor(private publish: (text: string, recipient?: string, images?: File[]) => Promise<ChatMessage>, private avatar: (name: string) => HTMLElement, private onUnread: () => void) {
    for (const id of ['chat-toggle', 'chat-focus-toggle', 'chat-hide']) el(id).addEventListener('click', () => this.toggle())
    el('chat-form').addEventListener('submit', event => { event.preventDefault(); void this.submit() })
    this.file.accept = CHAT_IMAGE_ACCEPT
    this.attach.addEventListener('click', () => {
      const conversation = this.conversations.get(this.active)
      if (!conversation || this.attach.disabled) return
      this.fileTarget = { conversation, generation: this.generation }
      this.file.value = ''; this.file.click()
    })
    this.file.addEventListener('change', () => {
      const target = this.fileTarget; this.fileTarget = null
      const images = [...(this.file.files ?? [])]; this.file.value = ''
      if (images.length && target?.generation === this.generation && this.conversations.get(target.conversation.id) === target.conversation) void this.prepareImages(images, target.conversation)
    })
    this.input.addEventListener('paste', event => {
      const files = [...(event.clipboardData?.files ?? [])]
      if (!files.length) return
      event.preventDefault()
      const conversation = this.conversations.get(this.active)
      if (conversation && !this.input.disabled) void this.prepareImages(files, conversation)
    })
    this.imageDialog.addEventListener('close', () => this.clearFullImage())
    this.imageDialog.addEventListener('click', event => { if (event.target === this.imageDialog) this.imageDialog.close() })
    this.imageDialog.addEventListener('keydown', event => {
      if (event.key === 'Escape') event.stopPropagation()
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      event.preventDefault(); event.stopPropagation()
      const thumbnailFocused = this.imageSequence.contains(document.activeElement)
      this.selectViewerImage(this.viewerIndex + (event.key === 'ArrowLeft' ? -1 : 1))
      if (thumbnailFocused) this.imageSequence.querySelector<HTMLButtonElement>('[aria-current="true"]')?.focus()
    })
    this.imagePrevious.addEventListener('click', () => this.selectViewerImage(this.viewerIndex - 1))
    this.imageNext.addEventListener('click', () => this.selectViewerImage(this.viewerIndex + 1))
    this.imageDialog.addEventListener('contextmenu', event => event.preventDefault())
    this.input.addEventListener('input', () => {
      const conversation = this.conversations.get(this.active)
      if (conversation) conversation.draft = this.input.value
      this.resizeInput(); this.syncComposer()
      this.error.hidden = true
    })
    this.input.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); void this.submit() }
    })
    this.log.addEventListener('scroll', () => {
      const conversation = this.conversations.get(this.active)
      if (!conversation) return
      conversation.scrollTop = this.log.scrollTop
      conversation.atBottom = this.atBottom()
      if (conversation.atBottom && this.isReading()) this.markRead()
      this.syncJump()
    })
    this.jump.addEventListener('click', () => this.scrollToBottom())
    window.addEventListener('focus', () => { if (this.isReading() && this.atBottom()) this.markRead() })
    document.addEventListener('visibilitychange', () => { if (this.isReading() && this.atBottom()) this.markRead() })
    document.addEventListener('keydown', event => {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'c' && this.roomName && !document.querySelector('dialog[open]')) { event.preventDefault(); this.toggle() }
    })
    this.observer = new ResizeObserver(() => {
      if (this.visible && this.conversations.get(this.active)?.atBottom) this.log.scrollTop = this.log.scrollHeight
    })
    this.observer.observe(this.log)
  }

  begin(name: string, server: string): void {
    this.reset()
    this.roomName = name
    this.server = new URL(server).href
    this.historyKey = JSON.stringify([this.server, name])
    const history = this.histories.get(this.historyKey)
    if (history) {
      this.conversations = history.conversations
      this.active = history.active
    } else {
      this.conversations.set('room', this.conversation('room', name))
      this.histories.set(this.historyKey, { conversations: this.conversations, active: this.active })
    }
    this.input.value = this.conversations.get(this.active)?.draft ?? ''
    this.renderAttachment()
    this.resizeInput()
    this.renderTabs(); this.renderMessages(); this.sync()
    if (this.visible && this.conversations.get(this.active)?.atBottom) this.scrollToBottom()
    this.onUnread()
  }

  /** Detach the UI on leave/switch, retaining this room's in-memory history. */
  reset(): void {
    for (const conversation of this.conversations.values()) { conversation.imageRevision++; conversation.preparing = false }
    if (this.historyKey) {
      const conversation = this.conversations.get(this.active)
      if (conversation) {
        conversation.draft = this.input.value
        if (this.visible) conversation.scrollTop = this.log.scrollTop
      }
      this.histories.set(this.historyKey, { conversations: this.conversations, active: this.active })
    }
    this.generation++
    this.fileTarget = null

    this.imageDialog.close(); this.clearFullImage(); this.clearImageUrls()
    this.roomName = null; this.connected = false; this.sending = false; this.active = 'room'
    this.historyKey = null
    this.conversations = new Map(); this.participants = []; this.input.value = ''; this.error.hidden = true
    this.renderAttachment()
    this.log.replaceChildren(); this.tabs.replaceChildren(); delete this.tabs.dataset.signature; this.clearBubbles(); this.sync()
    this.onUnread()
  }

  /** A server outage invalidates every cached room, including rooms left earlier. */
  clearHistory(): void {
    const name = this.roomName
    const server = this.server
    const connected = this.connected
    const participants = this.participants
    this.reset()
    this.histories.clear()
    if (name) {
      this.begin(name, server)
      this.setParticipants(participants)
      this.setConnection(connected)
    }
  }

  configure(bubbles: boolean): void {
    this.bubbles = bubbles
    if (!bubbles) this.clearBubbles()
    this.sync()
  }

  setConnection(connected: boolean): void { this.connected = connected; this.syncComposer() }

  setParticipants(participants: RoomParticipant[]): void {
    this.participants = participants
    for (const person of participants) {
      const conversation = this.conversations.get(person.id)
      if (conversation) conversation.name = person.name
    }
    this.renderTabs(); this.syncComposer()
  }

  unreadFor(id: string): number { return this.conversations.get(id)?.unread ?? 0 }

  whisper(id: string): void {
    const person = this.participants.find(person => person.id === id && !person.local)
    if (!this.roomName || !person) return
    if (!this.conversations.has(id)) this.conversations.set(id, this.conversation(id, person.name))
    this.select(id)
    this.visible = true; this.clearBubbles(); this.sync(); this.scrollToBottom(); this.input.focus()
  }

  receive(message: ChatMessage): void {
    if (!this.roomName) return
    const id = message.recipient ? (message.local ? message.recipient : message.senderId) : 'room'
    let conversation = this.conversations.get(id)
    if (!conversation) {
      conversation = this.conversation(id, this.participants.find(person => person.id === id)?.name || message.senderName)
      this.conversations.set(id, conversation)
    }
    if (conversation.messages.some(existing => existing.id === message.id && existing.senderId === message.senderId)) return
    const follows = id === this.active && conversation.atBottom
    conversation.messages.push(message)
    if (conversation.messages.length > MAX_HISTORY) conversation.messages.shift()
    if (!message.local && !(id === this.active && this.isReading() && follows)) conversation.unread++
    if (id === this.active && this.visible) this.appendMessage(message, conversation.messages.at(-2))
    if (message.images?.length && this.trimImageHistory()) this.renderMessages()
    if (follows && this.visible) this.scrollToBottom(false)
    this.renderTabs(); this.sync(); this.onUnread()
    if (!message.local && !this.visible && this.bubbles) this.showBubble(message, id)
  }

  private conversation(id: string, name: string): Conversation { return { id, name, messages: [], unread: 0, draft: '', scrollTop: 0, atBottom: true, images: [], imageRevision: 0, preparing: false } }
  private atBottom(): boolean { return this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < 40 }
  private isReading(): boolean { return this.visible && document.visibilityState === 'visible' && document.hasFocus() }

  private toggle(): void {
    if (!this.roomName) return
    this.visible = !this.visible
    this.sync()
    if (this.visible) {
      this.clearBubbles(); this.renderMessages()
      if (this.conversations.get(this.active)?.atBottom) this.scrollToBottom()
      this.input.focus()
    }
  }

  private select(id: string): void {
    if (!this.conversations.has(id)) return
    const previous = this.conversations.get(this.active)
    if (previous) { previous.draft = this.input.value; previous.scrollTop = this.log.scrollTop }
    this.active = id
    this.input.value = this.conversations.get(id)!.draft
    this.renderAttachment()
    this.error.hidden = true
    this.resizeInput(); this.renderTabs(); this.renderMessages(); this.syncComposer()
    if (this.visible && this.conversations.get(id)!.atBottom) this.scrollToBottom()
    this.sync()
  }

  private markRead(): void {
    const conversation = this.conversations.get(this.active)
    if (!conversation?.unread) return
    conversation.unread = 0
    this.renderTabs(); this.sync(); this.onUnread()
  }

  private scrollToBottom(mark = true): void {
    this.log.scrollTop = this.log.scrollHeight
    const conversation = this.conversations.get(this.active)
    if (conversation) { conversation.atBottom = true; conversation.scrollTop = this.log.scrollTop }
    if (mark && this.isReading()) this.markRead()
    this.syncJump()
  }

  private sync(): void {
    const open = Boolean(this.roomName) && this.visible
    this.panel.hidden = !open
    const workspace = el('room-workspace')
    workspace.classList.toggle('chat-open', open)
    workspace.dataset.chatPosition = 'right'
    const unread = [...this.conversations.values()].reduce((sum, conversation) => sum + conversation.unread, 0)
    for (const id of ['chat-toggle', 'chat-focus-toggle']) {
      const button = el(id) as HTMLButtonElement
      button.hidden = !this.roomName
      labelButton(button, `${open ? 'Hide' : 'Show'} chat${unread ? `, ${unread} unread messages` : ''}`)
      button.setAttribute('aria-expanded', String(open))
      this.badge(button.querySelector('.chat-badge')!, unread)
    }
    this.syncComposer(); this.syncJump()
  }

  private syncComposer(): void {
    const peerGone = this.active !== 'room' && !this.participants.some(person => person.id === this.active)
    const conversation = this.conversations.get(this.active)
    this.input.disabled = !this.connected || peerGone || this.sending || Boolean(conversation?.preparing)
    this.attach.disabled = this.input.disabled
    for (const button of this.attachment.querySelectorAll<HTMLButtonElement>('button')) button.disabled = this.input.disabled
    this.send.disabled = this.input.disabled || (!this.input.value.trim() && !conversation?.images.length)
    this.input.placeholder = !this.connected ? 'Reconnecting…' : peerGone ? 'This person has left' : this.active === 'room' ? `Message #${this.roomName ?? ''}` : `Whisper to ${this.conversations.get(this.active)?.name ?? ''}`
    this.input.setAttribute('aria-label', this.input.placeholder)
  }

  private syncJump(): void {
    const conversation = this.conversations.get(this.active)
    this.jump.hidden = !conversation || conversation.atBottom
    this.badge(this.jump.querySelector('.chat-badge')!, conversation?.unread ?? 0)
  }

  private badge(element: Element, count: number): void {
    (element as HTMLElement).hidden = count === 0
    element.textContent = count > 99 ? '+99' : String(count)
  }

  private renderTabs(): void {
    // Preserve focus and avoid rebuilding tabs on every roster poll.
    const signature = JSON.stringify([...this.conversations.values()].map(conversation => [conversation.id, conversation.name, conversation.unread, conversation.id === this.active]))
    if (this.tabs.dataset.signature === signature) return
    const focused = (document.activeElement as HTMLElement)?.dataset.tabId
    this.tabs.dataset.signature = signature
    this.tabs.replaceChildren()
    for (const conversation of this.conversations.values()) {
      const item = document.createElement('div'); item.className = 'chat-tab-item'
      item.classList.toggle('is-active', conversation.id === this.active)
      const tab = document.createElement('button'); tab.type = 'button'; tab.className = 'chat-tab'
      tab.dataset.tabId = conversation.id; tab.setAttribute('role', 'tab')
      tab.id = `chat-tab-${conversation.id}`
      tab.setAttribute('aria-controls', 'chat-messages'); tab.setAttribute('aria-selected', String(conversation.id === this.active))
      tab.tabIndex = conversation.id === this.active ? 0 : -1
      tab.title = conversation.id === 'room' ? `Room: ${conversation.name}` : `Whisper: ${conversation.name}`
      tab.innerHTML = icon(conversation.id === 'room' ? 'hash' : 'private')
      tab.append(Object.assign(document.createElement('span'), { className: 'chat-tab-name', textContent: conversation.name }))
      if (conversation.unread) { const badge = Object.assign(document.createElement('span'), { className: 'chat-badge' }); this.badge(badge, conversation.unread); tab.append(badge) }
      tab.addEventListener('click', () => this.select(conversation.id))
      tab.addEventListener('keydown', event => {
        const ids = [...this.conversations.keys()]; let index = ids.indexOf(conversation.id)
        if (event.key === 'ArrowRight') index = (index + 1) % ids.length
        else if (event.key === 'ArrowLeft') index = (index - 1 + ids.length) % ids.length
        else if (event.key === 'Home') index = 0
        else if (event.key === 'End') index = ids.length - 1
        else return
        event.preventDefault(); this.select(ids[index]); this.tabs.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus()
      })
      item.append(tab)
      if (conversation.id !== 'room') {
        const close = Object.assign(document.createElement('button'), { type: 'button', className: 'chat-tab-close' })
        labelButton(close, `Close whisper with ${conversation.name}`); close.innerHTML = icon('close')
        close.addEventListener('click', () => {
          if (this.active === conversation.id) this.select('room')
          this.conversations.delete(conversation.id); this.renderTabs(); this.sync(); this.onUnread()
          this.tabs.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus()
        })
        item.append(close)
      }
      this.tabs.append(item)
    }
    if (focused) [...this.tabs.querySelectorAll<HTMLButtonElement>('[data-tab-id]')].find(tab => tab.dataset.tabId === focused)?.focus()
    this.log.setAttribute('aria-labelledby', `chat-tab-${this.active}`)
  }

  private renderMessages(): void {
    const conversation = this.conversations.get(this.active)
    this.clearImageUrls(); this.log.replaceChildren()
    if (!conversation) return
    if (!conversation.messages.length) {
      const empty = Object.assign(document.createElement('div'), { className: 'chat-empty' })
      empty.innerHTML = icon(this.active === 'room' ? 'chat' : 'private')
      empty.append(Object.assign(document.createElement('span'), { textContent: this.active === 'room' ? `#${conversation.name}` : conversation.name }))
      this.log.append(empty)
    }
    conversation.messages.forEach((message, index) => this.appendMessage(message, conversation.messages[index - 1]))
    this.log.scrollTop = conversation.atBottom ? this.log.scrollHeight : conversation.scrollTop
    this.syncJump()
  }

  private appendMessage(message: ChatMessage, previous?: ChatMessage): void {
    this.log.querySelector('.chat-empty')?.remove()
    const newDay = !previous || new Date(previous.timestamp).toDateString() !== new Date(message.timestamp).toDateString()
    if (newDay) this.log.append(Object.assign(document.createElement('div'), { className: 'chat-day', textContent: day.format(message.timestamp) }))
    const grouped = !newDay && previous?.senderId === message.senderId && previous.senderName === message.senderName && message.timestamp >= previous.timestamp && message.timestamp - previous.timestamp < 300_000
    let group = grouped ? this.log.lastElementChild as HTMLElement : null
    if (!group || !group.classList.contains('chat-message-group')) {
      group = document.createElement('article'); group.className = 'chat-message-group'
      const avatar = this.avatar(message.senderName); avatar.classList.add('chat-avatar')
      const body = document.createElement('div'); body.className = 'chat-message-body'
      const head = document.createElement('header'); head.className = 'chat-message-head'
      const name = Object.assign(document.createElement('button'), { type: 'button', className: 'chat-sender', textContent: message.senderName })
      name.disabled = message.local; name.title = message.local ? 'You' : `Whisper to ${message.senderName}`
      name.addEventListener('click', () => this.whisper(message.senderId))
      const timestamp = Object.assign(document.createElement('time'), { textContent: time.format(message.timestamp), dateTime: new Date(message.timestamp).toISOString(), title: new Date(message.timestamp).toLocaleString() })
      head.append(name, timestamp); body.append(head); group.append(avatar, body); this.log.append(group)
    }
    const content = document.createElement('div'); content.className = 'chat-message-text'; content.dataset.messageId = message.id
    content.title = new Date(message.timestamp).toLocaleString()
    renderText(content, message.text, () => { if (this.conversations.get(this.active)?.atBottom) this.log.scrollTop = this.log.scrollHeight }, (element, target) => this.bindImageViewer(element, target))
    if (message.images?.length) {
      const gallery = Object.assign(document.createElement('div'), { className: 'chat-image-gallery' })
      for (const image of message.images) {
        const attachment = Object.assign(document.createElement('button'), { type: 'button', className: 'chat-image-attachment' })
        labelButton(attachment, `Open image: ${image.name}`)
        const url = URL.createObjectURL(image.blob); this.imageUrls.add(url)
        const preview = Object.assign(document.createElement('img'), { src: url, alt: image.name, loading: 'lazy' })
        preview.addEventListener('load', () => { if (this.conversations.get(this.active)?.atBottom) this.log.scrollTop = this.log.scrollHeight })
        preview.addEventListener('error', () => { attachment.textContent = 'Image could not be displayed.' })
        attachment.append(preview); gallery.append(attachment)
        this.bindImageViewer(attachment, image, message.images)
      }
      content.append(gallery)
    }
    if (message.imageExpired) content.append(document.createTextNode(' [Image removed from memory]'))
    group.querySelector('.chat-message-body')!.append(content)
    // Bound both retained history and rendered nodes without splitting groups.
    const messages = this.log.querySelectorAll('.chat-message-text')
    if (messages.length > MAX_HISTORY) {
      const first = messages[0]; const parent = first.closest('.chat-message-group')!
      for (const image of first.querySelectorAll<HTMLImageElement>('.chat-image-attachment img')) { URL.revokeObjectURL(image.src); this.imageUrls.delete(image.src) }
      first.remove()
      if (!parent.querySelector('.chat-message-text')) { parent.previousElementSibling?.classList.contains('chat-day') && parent.previousElementSibling.remove(); parent.remove() }
    }
  }

  private resizeInput(): void { this.input.style.height = 'auto'; this.input.style.height = `${Math.min(100, this.input.scrollHeight)}px` }

  private async prepareImages(images: File[], conversation: Conversation): Promise<void> {
    if (this.sending || conversation.preparing || !this.connected) return
    const generation = this.generation; const revision = ++conversation.imageRevision
    conversation.preparing = true; this.error.hidden = true; this.syncComposer()
    try {
      if (conversation.images.length + images.length > CHAT_IMAGE_MAX_COUNT) throw new Error(`You can attach up to ${CHAT_IMAGE_MAX_COUNT} images per message.`)
      for (const image of images) {
        await validateChatImage(image)
        // Decode each image before adding the selection to the draft.
        const bitmap = await createImageBitmap(image); bitmap.close()
      }
      if (generation !== this.generation || revision !== conversation.imageRevision || this.conversations.get(conversation.id) !== conversation) return
      conversation.images.push(...images)
    } catch (error) {
      if (generation === this.generation && conversation.id === this.active) {
        this.error.textContent = error instanceof Error ? error.message : 'Could not load these images.'; this.error.hidden = false
      }
    } finally {
      if (revision === conversation.imageRevision) conversation.preparing = false
      if (generation === this.generation) { this.renderAttachment(); this.syncComposer() }
    }
  }

  private renderAttachment(): void {
    for (const url of this.attachmentUrls) URL.revokeObjectURL(url)
    this.attachmentUrls.clear(); this.attachment.replaceChildren()
    const conversation = this.conversations.get(this.active)
    const images = conversation?.images ?? []
    this.attachment.hidden = !images.length
    if (!conversation || !images.length) return
    this.attachment.append(Object.assign(document.createElement('span'), { className: 'chat-attachment-count', textContent: `${images.length} / ${CHAT_IMAGE_MAX_COUNT}` }))
    const list = Object.assign(document.createElement('div'), { className: 'chat-attachment-list' })
    for (const [index, image] of images.entries()) {
      const item = Object.assign(document.createElement('div'), { className: 'chat-attachment-item' })
      const url = URL.createObjectURL(image); this.attachmentUrls.add(url)
      const preview = Object.assign(document.createElement('img'), { className: 'chat-attachment-preview', src: url, alt: image.name })
      const name = Object.assign(document.createElement('span'), { className: 'chat-attachment-name', textContent: image.name, title: image.name })
      const remove = Object.assign(document.createElement('button'), { className: 'chat-attachment-remove icon-button', type: 'button', disabled: this.input.disabled })
      labelButton(remove, `Remove image: ${image.name}`); remove.innerHTML = icon('close')
      remove.addEventListener('click', () => {
        if (remove.disabled) return
        conversation.imageRevision++; conversation.images.splice(index, 1)
        this.renderAttachment(); this.syncComposer(); this.input.focus()
      })
      item.append(preview, name, remove); list.append(item)
    }
    this.attachment.append(list)
  }

  private clearImageUrls(): void { for (const url of this.imageUrls) URL.revokeObjectURL(url); this.imageUrls.clear() }
  private clearFullImage(): void {
    this.fullImage.removeAttribute('src')
    this.imageSequence.replaceChildren(); this.imageSequence.hidden = true
    this.imagePrevious.hidden = true; this.imageNext.hidden = true
    this.imageDialog.classList.remove('has-image-sequence')
    el('chat-image-position').textContent = ''
    for (const url of this.viewerUrls) URL.revokeObjectURL(url)
    this.viewerUrls.clear(); this.viewerImages = []; this.viewerIndex = 0
  }
  private openImage(image: ImageTarget, images: ImageTarget[] = [image]): void {
    this.clearFullImage()
    this.viewerImages = images.map(target => {
      const url = 'url' in target ? target.url : URL.createObjectURL(target.blob)
      if ('blob' in target) this.viewerUrls.add(url)
      return { url, name: target.name }
    })
    const multiple = images.length > 1
    this.imageSequence.hidden = !multiple; this.imagePrevious.hidden = !multiple; this.imageNext.hidden = !multiple
    this.imageDialog.classList.toggle('has-image-sequence', multiple)
    if (multiple) for (const [index, target] of this.viewerImages.entries()) {
      const button = Object.assign(document.createElement('button'), { type: 'button', className: 'chat-image-thumbnail' })
      labelButton(button, `View image ${index + 1} of ${images.length}: ${target.name}`)
      const preview = Object.assign(document.createElement('img'), { src: target.url, alt: '', referrerPolicy: 'no-referrer', draggable: false })
      button.append(preview); button.addEventListener('click', () => this.selectViewerImage(index))
      this.imageSequence.append(button)
    }
    this.selectViewerImage(Math.max(0, images.indexOf(image)))
    if (!this.imageDialog.open) this.imageDialog.showModal()
    this.scrollViewerThumbnail()
  }

  private selectViewerImage(index: number): void {
    const image = this.viewerImages[index]
    if (!image) return
    this.viewerIndex = index
    this.fullImage.src = image.url; this.fullImage.referrerPolicy = 'no-referrer'; this.fullImage.alt = image.name
    const focused = document.activeElement
    this.imagePrevious.disabled = index === 0; this.imageNext.disabled = index === this.viewerImages.length - 1
    if ((focused === this.imagePrevious && this.imagePrevious.disabled) || (focused === this.imageNext && this.imageNext.disabled)) this.imageDialog.focus()
    for (const [position, button] of [...this.imageSequence.children].entries()) {
      if (position === index) button.setAttribute('aria-current', 'true')
      else button.removeAttribute('aria-current')
    }
    el('chat-image-position').textContent = `Image ${index + 1} of ${this.viewerImages.length}: ${image.name}`
    this.scrollViewerThumbnail()
  }

  private scrollViewerThumbnail(): void {
    this.imageSequence.querySelector<HTMLElement>('[aria-current="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }

  private bindImageViewer(element: HTMLElement, image: ImageTarget, images?: ImageTarget[]): void {
    element.addEventListener('click', event => { event.preventDefault(); this.openImage(image, images) })
    element.addEventListener('contextmenu', event => event.preventDefault())
  }

  private trimImageHistory(): boolean {
    const messages = [...this.histories.values()].flatMap(history => [...history.conversations.values()].flatMap(conversation => conversation.messages)).filter(message => message.images?.length)
    let bytes = messages.reduce((total, message) => total + message.images!.reduce((sum, image) => sum + image.size, 0), 0)
    let trimmed = false
    for (const message of messages.sort((a, b) => a.timestamp - b.timestamp)) {
      while (bytes > MAX_IMAGE_HISTORY_BYTES && message.images?.length) {
        bytes -= message.images.shift()!.size; message.imageExpired = true; trimmed = true
      }
      if (bytes <= MAX_IMAGE_HISTORY_BYTES) break
    }
    return trimmed
  }

  private async submit(): Promise<void> {
    const text = this.input.value.trim()
    const conversation = this.conversations.get(this.active)
    if ((!text && !conversation?.images.length) || this.sending || this.input.disabled) return
    if (text.length > CHAT_MAX_LENGTH) { this.error.textContent = `Maximum ${CHAT_MAX_LENGTH} characters.`; this.error.hidden = false; return }
    if (!conversation) return
    const generation = this.generation
    this.sending = true; this.error.hidden = true; this.syncComposer()
    try {
      const message = await this.publish(text, conversation.id === 'room' ? undefined : conversation.id, conversation.images)
      if (generation !== this.generation) return
      conversation.draft = ''
      conversation.images = []
      if (conversation.id === this.active) { this.input.value = ''; this.renderAttachment(); this.resizeInput() }
      this.receive(message)
    } catch (error) {
      if (generation !== this.generation) return
      this.error.textContent = error instanceof Error ? error.message : 'Could not send. Try again.'; this.error.hidden = false
    } finally {
      if (generation === this.generation) { this.sending = false; this.syncComposer(); if (this.visible) this.input.focus() }
    }
  }

  private showBubble(message: ChatMessage, id: string): void {
    while (this.bubbleHost.children.length >= 2) this.removeBubble(this.bubbleHost.firstElementChild as HTMLElement)
    const bubble = Object.assign(document.createElement('button'), { type: 'button', className: 'chat-bubble' })
    const copy = document.createElement('span'); copy.className = 'chat-bubble-copy'
    const heading = Object.assign(document.createElement('strong'), { textContent: message.senderName })
    if (id !== 'room') { const lock = document.createElement('span'); lock.innerHTML = icon('private'); heading.append(lock) }
    copy.append(heading, Object.assign(document.createElement('span'), { textContent: message.text || (message.images?.length ? (message.images.length === 1 ? 'Shared an image' : `Shared ${message.images.length} images`) : '') }))
    bubble.append(this.avatar(message.senderName), copy)
    labelButton(bubble, `Open ${id === 'room' ? 'room chat' : `whisper from ${message.senderName}`}`)
    bubble.addEventListener('click', () => { this.visible = true; this.select(id); this.clearBubbles(); this.sync(); this.scrollToBottom(); this.input.focus() })
    this.bubbleHost.append(bubble)
    this.bubbleTimers.set(bubble, window.setTimeout(() => this.removeBubble(bubble), 5_000))
  }

  private removeBubble(bubble: HTMLElement): void { window.clearTimeout(this.bubbleTimers.get(bubble)); this.bubbleTimers.delete(bubble); bubble.remove() }
  private clearBubbles(): void { for (const bubble of this.bubbleTimers.keys()) this.removeBubble(bubble) }
}

function safeUrl(raw: string): URL | null {
  try { const url = new URL(/^www\./i.test(raw) ? `https://${raw}` : raw); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url : null } catch { return null }
}

function renderText(target: HTMLElement, text: string, onLoad: () => void, bindImage: (element: HTMLElement, image: ImageTarget) => void): void {
  const urls: URL[] = []; let cursor = 0
  for (const match of text.matchAll(/(?:https?:\/\/|www\.)[^\s<>]+/gi)) {
    let raw = match[0].replace(/[.,!?;:]+$/, '')
    // Strip prose delimiters, retaining balanced parentheses in URLs.
    while (raw.endsWith(')') && (raw.match(/\)/g)?.length ?? 0) > (raw.match(/\(/g)?.length ?? 0)) raw = raw.slice(0, -1)
    raw = raw.replace(/[\]}]+$/, '')
    const url = safeUrl(raw)
    target.append(document.createTextNode(text.slice(cursor, match.index)))
    if (url) {
      const link = Object.assign(document.createElement('a'), { href: url.href, textContent: raw, target: '_blank', rel: 'noopener noreferrer' })
      target.append(link)
      if (!urls.some(existing => existing.href === url.href)) urls.push(url)
    } else target.append(document.createTextNode(raw))
    cursor = match.index + raw.length
  }
  target.append(document.createTextNode(text.slice(cursor)))
  for (const url of urls.slice(0, 2)) {
    if (url.protocol === 'https:' && /\.(png|jpe?g|gif|webp|avif)$/i.test(url.pathname)) {
      const link = Object.assign(document.createElement('a'), { href: url.href, target: '_blank', rel: 'noopener noreferrer', className: 'chat-image-link' })
      const image = Object.assign(document.createElement('img'), { src: url.href, alt: 'Shared image', loading: 'lazy', referrerPolicy: 'no-referrer' })
      image.addEventListener('load', onLoad); image.addEventListener('error', () => link.remove())
      let name = 'Shared image'
      try { name = decodeURIComponent(url.pathname.split('/').at(-1) || name) } catch { /* Keep fallback label. */ }
      bindImage(link, { url: url.href, name })
      link.append(image); target.append(link)
      continue
    }
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
