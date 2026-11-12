import type { Id, Message } from '../../../shared/protocol'
import { makeAvatar } from '../avatar'
import { icon, labelButton } from '../icons'
import { api, errorText } from './api'
import type { ZodiakStore } from './store'

const PAGE = 50
/** Messages from the same author within this time share one header. */
const GROUP_MS = 7 * 60 * 1000
const LINK = /\bhttps?:\/\/[^\s<>"']+/g

type Confirm = (title: string, message: string, action: string, run: () => Promise<void>) => void

function el<T extends HTMLElement>(id: string, type: new () => T): T {
  const element = document.getElementById(id)
  if (!(element instanceof type)) throw new Error(`Missing #${id}`)
  return element
}

/** Splits text into text nodes and links. Only http and https links become anchors. */
export function linkify(text: string): Node[] {
  const nodes: Node[] = []
  let last = 0
  for (const match of text.matchAll(LINK)) {
    const raw = match[0].replace(/[),.!?:;]+$/, '')
    const start = match.index ?? 0
    let url: URL | null = null
    try { url = new URL(raw) } catch { url = null }
    if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) continue
    if (start > last) nodes.push(document.createTextNode(text.slice(last, start)))
    const anchor = Object.assign(document.createElement('a'), { href: url.href, target: '_blank', rel: 'noopener noreferrer', textContent: raw })
    nodes.push(anchor)
    last = start + raw.length
  }
  if (last < text.length) nodes.push(document.createTextNode(text.slice(last)))
  return nodes
}


const time = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })
const day = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

export class TextChannelView {
  private channelId: Id | null = null
  private loading = false
  private editing: Id | null = null
  private readonly log = el('text-messages', HTMLDivElement)
  private readonly form = el('text-form', HTMLFormElement)
  private readonly input = el('text-input', HTMLTextAreaElement)
  private readonly note = el('text-note', HTMLParagraphElement)
  private readonly title = el('text-title', HTMLHeadingElement)

  constructor(private readonly store: ZodiakStore, private readonly confirm: Confirm) {
    store.subscribe((change) => {
      if (!this.channelId) return
      if (change.kind === 'all' || (change.kind === 'messages' && change.channelId === this.channelId)) this.render()
      if (change.kind !== 'messages') this.title.textContent = store.channel(this.channelId)?.name ?? ''
    })
    this.form.addEventListener('submit', (event) => { event.preventDefault(); void this.send() })
    this.input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); void this.send() }
    })
    this.input.addEventListener('input', () => this.resize())
    this.log.addEventListener('scroll', () => { if (this.log.scrollTop < 120) void this.loadOlder() })
  }

  close(): void {
    this.channelId = null
    this.log.replaceChildren()
  }

  open(channelId: Id | null): void {
    if (channelId === this.channelId) return
    this.channelId = channelId
    this.editing = null
    this.note.hidden = true
    if (!channelId) { this.log.replaceChildren(); return }
    this.title.textContent = this.store.channel(channelId)?.name ?? ''
    this.input.placeholder = `Message #${this.store.channel(channelId)?.name ?? ''}`
    this.render()
    this.stickToBottom()
    if (!this.store.history(channelId)) void this.loadOlder()
    requestAnimationFrame(() => this.input.focus())
  }

  private async loadOlder(): Promise<void> {
    const channelId = this.channelId
    if (!channelId || this.loading || this.store.history(channelId)?.complete) return
    this.loading = true
    const oldest = this.store.history(channelId)?.messages[0]?.id
    try {
      const query = `limit=${PAGE}${oldest ? `&before=${oldest}` : ''}`
      const page = await api<Message[]>('GET', `/v1/channels/${channelId}/messages?${query}`)
      if (channelId !== this.channelId) return
      const fromBottom = this.log.scrollHeight - this.log.scrollTop
      this.store.addOlder(channelId, page, PAGE)
      // Keep the visible messages in place when older ones are added above.
      this.log.scrollTop = oldest ? this.log.scrollHeight - fromBottom : this.log.scrollHeight
    } catch (error) {
      this.showError(errorText(error))
    } finally {
      this.loading = false
    }
  }

  private async send(): Promise<void> {
    const channelId = this.channelId
    const content = this.input.value
    if (!channelId || !content.trim()) return
    this.input.value = ''
    this.resize()
    this.note.hidden = true
    try {
      const message = await api<Message>('POST', `/v1/channels/${channelId}/messages`, { content })
      this.store.upsertMessage(message)
      this.stickToBottom()
    } catch (error) {
      if (!this.input.value) this.input.value = content
      this.resize()
      this.showError(errorText(error))
    }
  }

  private showError(message: string): void {
    this.note.textContent = message
    this.note.dataset.tone = 'error'
    this.note.hidden = false
  }

  private resize(): void {
    this.input.style.height = 'auto'
    this.input.style.height = `${Math.min(this.input.scrollHeight, 200)}px`
  }

  private stickToBottom(): void {
    requestAnimationFrame(() => { this.log.scrollTop = this.log.scrollHeight })
  }

  private render(): void {
    const channelId = this.channelId
    if (!channelId) return
    const history = this.store.history(channelId)
    const nearBottom = this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < 80
    const fragment = document.createDocumentFragment()
    if (history?.complete) {
      fragment.append(Object.assign(document.createElement('p'), { className: 'text-start', textContent: `This is the start of #${this.store.channel(channelId)?.name ?? ''}.` }))
    }
    let previous: Message | undefined
    let body: HTMLElement | null = null
    for (const message of history?.messages ?? []) {
      const at = new Date(message.created_at)
      if (!previous || day.format(new Date(previous.created_at)) !== day.format(at)) {
        fragment.append(Object.assign(document.createElement('div'), { className: 'chat-day', textContent: day.format(at) }))
        body = null
      }
      const grouped = body && previous && previous.author.id === message.author.id && at.getTime() - new Date(previous.created_at).getTime() < GROUP_MS
      if (!grouped) {
        const group = Object.assign(document.createElement('article'), { className: 'chat-message-group' })
        const avatar = makeAvatar(message.author.display_name, 'chat-avatar')
        body = Object.assign(document.createElement('div'), { className: 'chat-message-body' })
        const head = Object.assign(document.createElement('header'), { className: 'chat-message-head' })
        head.append(
          Object.assign(document.createElement('span'), { className: 'chat-sender', textContent: message.author.display_name, title: `@${message.author.username}` }),
          Object.assign(document.createElement('time'), { dateTime: message.created_at, textContent: time.format(at) }),
        )
        body.append(head)
        group.append(avatar, body)
        fragment.append(group)
      }
      body!.append(this.messageRow(message))
      previous = message
    }
    this.log.replaceChildren(fragment)
    if (nearBottom) this.log.scrollTop = this.log.scrollHeight
  }

  private messageRow(message: Message): HTMLElement {
    const row = Object.assign(document.createElement('div'), { className: 'text-message' })
    row.dataset.messageId = message.id
    const mine = message.author.id === this.store.user?.id
    const canDelete = mine || this.store.isOwner(message.guild_id)
    if (this.editing === message.id) {
      row.append(this.editor(message))
      return row
    }
    const content = Object.assign(document.createElement('div'), { className: 'chat-message-text' })
    content.append(...linkify(message.content))
    if (message.edited_at) content.append(Object.assign(document.createElement('span'), { className: 'text-edited', textContent: ' (edited)' }))
    row.append(content)
    if (mine || canDelete) {
      const actions = Object.assign(document.createElement('div'), { className: 'text-message-actions' })
      if (mine) {
        const edit = Object.assign(document.createElement('button'), { type: 'button', className: 'icon-button', innerHTML: icon('edit') })
        labelButton(edit, 'Edit message')
        edit.addEventListener('click', () => { this.editing = message.id; this.render() })
        actions.append(edit)
      }
      const remove = Object.assign(document.createElement('button'), { type: 'button', className: 'icon-button text-delete', innerHTML: icon('trash') })
      labelButton(remove, 'Delete message')
      remove.addEventListener('click', () => this.confirm('Delete message', 'Delete this message?', 'Delete', async () => {
        await api('DELETE', `/v1/channels/${message.channel_id}/messages/${message.id}`)
      }))
      actions.append(remove)
      row.append(actions)
    }
    return row
  }

  private editor(message: Message): HTMLElement {
    const editor = Object.assign(document.createElement('textarea'), { className: 'text-edit', value: message.content, maxLength: 2000, rows: 2 })
    editor.setAttribute('aria-label', 'Edit message')
    const hint = Object.assign(document.createElement('p'), { className: 'text-edit-hint', textContent: 'Enter to save · Esc to cancel' })
    const wrap = document.createElement('div')
    wrap.append(editor, hint)
    const cancel = () => { this.editing = null; this.render() }
    editor.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.preventDefault(); cancel() }
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault()
        const content = editor.value
        if (!content.trim() || content === message.content) { cancel(); return }
        editor.disabled = true
        void api<Message>('PATCH', `/v1/channels/${message.channel_id}/messages/${message.id}`, { content })
          .then((updated) => { this.editing = null; this.store.upsertMessage(updated) })
          .catch((error) => { editor.disabled = false; hint.textContent = errorText(error) })
      }
    })
    requestAnimationFrame(() => { editor.focus(); editor.setSelectionRange(editor.value.length, editor.value.length) })
    return wrap
  }
}
