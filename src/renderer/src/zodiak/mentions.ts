import type { Member, User } from '../../../shared/protocol'
import { makeAvatar } from '../avatar'

/** `@name` where name is a username (a-z, 0-9, _ and .) or a display name without spaces. */
const MENTION = /(^|[^\w@.])@([\p{L}\p{N}_.]{1,32})/gu
const MAX_SUGGESTIONS = 8

/** The member an `@name` refers to: the username first, then a display name that only one member has. */
export function resolveMention(name: string, members: readonly Member[]): User | undefined {
  const wanted = name.replace(/\.+$/, '').toLocaleLowerCase()
  if (!wanted) return undefined
  const byUsername = members.find((m) => m.user.username.toLocaleLowerCase() === wanted)
  if (byUsername) return byUsername.user
  const byName = members.filter((m) => m.user.display_name.toLocaleLowerCase() === wanted)
  return byName.length === 1 ? byName[0].user : undefined
}

/** True when the text mentions the user by username or display name. */
export function mentionsUser(text: string, members: readonly Member[], userId: string): boolean {
  for (const match of text.matchAll(MENTION)) {
    if (resolveMention(match[2], members)?.id === userId) return true
  }
  return false
}

/** Replaces `@name` in the text nodes with mention chips. Links are not changed. */
export function withMentions(nodes: Node[], members: readonly Member[], selfId: string | undefined): Node[] {
  const result: Node[] = []
  for (const node of nodes) {
    if (node.nodeType !== Node.TEXT_NODE) { result.push(node); continue }
    const text = node.textContent ?? ''
    let last = 0
    for (const match of text.matchAll(MENTION)) {
      const user = resolveMention(match[2], members)
      if (!user) continue
      const start = (match.index ?? 0) + match[1].length
      const raw = `@${match[2].replace(/\.+$/, '')}`
      if (start > last) result.push(document.createTextNode(text.slice(last, start)))
      const chip = Object.assign(document.createElement('span'), { className: `mention${user.id === selfId ? ' is-self' : ''}`, textContent: `@${user.display_name}`, title: `@${user.username}` })
      result.push(chip)
      last = start + raw.length
    }
    if (last === 0) result.push(node)
    else if (last < text.length) result.push(document.createTextNode(text.slice(last)))
  }
  return result
}

/** The `@query` the caret is in, if any. */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const match = /(^|[^\w@.])@([\p{L}\p{N}_.]{0,32})$/u.exec(text.slice(0, caret))
  if (!match) return null
  return { start: caret - match[2].length - 1, query: match[2] }
}

/** Members whose username or display name starts with the query, best matches first. */
export function mentionSuggestions(query: string, members: readonly Member[], selfId?: string): User[] {
  const wanted = query.toLocaleLowerCase()
  const rank = (user: User): number => {
    const username = user.username.toLocaleLowerCase()
    const name = user.display_name.toLocaleLowerCase()
    if (username === wanted || name === wanted) return 0
    if (username.startsWith(wanted)) return 1
    if (name.startsWith(wanted)) return 2
    if (name.split(/\s+/).some((word) => word.startsWith(wanted))) return 3
    return -1
  }
  const collator = new Intl.Collator(undefined, { sensitivity: 'base' })
  return members
    .map((m) => ({ user: m.user, score: rank(m.user) }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => a.score - b.score || Number(a.user.id === selfId) - Number(b.user.id === selfId) || collator.compare(a.user.display_name, b.user.display_name))
    .slice(0, MAX_SUGGESTIONS)
    .map((entry) => entry.user)
}

/** Suggests people while the user types `@name` in a message box. Picking one inserts `@username`. */
export class MentionAutocomplete {
  private readonly list = Object.assign(document.createElement('div'), { className: 'mention-suggestions', id: 'mention-suggestions', hidden: true })
  private matches: User[] = []
  private selected = 0
  private query: { start: number; query: string } | null = null

  constructor(private readonly input: HTMLTextAreaElement, host: HTMLElement, private readonly members: () => readonly Member[], private readonly selfId: () => string | undefined) {
    this.list.setAttribute('role', 'listbox')
    this.list.setAttribute('aria-label', 'People to mention')
    host.append(this.list)
    input.setAttribute('aria-autocomplete', 'list')
    input.setAttribute('aria-controls', this.list.id)
    input.addEventListener('input', () => this.update())
    input.addEventListener('click', () => this.update())
    input.addEventListener('blur', () => window.setTimeout(() => this.close(), 120))
    // Capture on the form, so Enter picks a person before the message is sent.
    host.addEventListener('keydown', (event) => this.keydown(event), true)
    this.list.addEventListener('pointerdown', (event) => event.preventDefault())
  }

  close(): void {
    this.query = null
    this.matches = []
    this.list.hidden = true
    this.input.removeAttribute('aria-activedescendant')
    this.input.setAttribute('aria-expanded', 'false')
  }

  private update(): void {
    const query = mentionQuery(this.input.value, this.input.selectionStart ?? this.input.value.length)
    if (!query) { this.close(); return }
    const matches = mentionSuggestions(query.query, this.members(), this.selfId())
    if (!matches.length) { this.close(); return }
    if (this.query?.query !== query.query) this.selected = 0
    this.query = query
    this.matches = matches
    this.selected = Math.min(this.selected, matches.length - 1)
    this.render()
  }

  private render(): void {
    this.list.replaceChildren(...this.matches.map((user, index) => {
      const option = Object.assign(document.createElement('div'), { className: 'mention-option', id: `mention-option-${index}` })
      option.setAttribute('role', 'option')
      option.setAttribute('aria-selected', String(index === this.selected))
      option.append(
        makeAvatar(user.display_name, 'mention-avatar'),
        Object.assign(document.createElement('span'), { className: 'mention-name', textContent: user.display_name }),
        Object.assign(document.createElement('span'), { className: 'mention-username', textContent: `@${user.username}` }),
      )
      option.addEventListener('mouseenter', () => { this.selected = index; this.highlight() })
      option.addEventListener('click', () => this.pick(index))
      return option
    }))
    this.list.hidden = false
    this.input.setAttribute('aria-expanded', 'true')
    this.highlight()
  }

  private highlight(): void {
    for (const [index, option] of [...this.list.children].entries()) option.setAttribute('aria-selected', String(index === this.selected))
    this.input.setAttribute('aria-activedescendant', `mention-option-${this.selected}`)
    this.list.children[this.selected]?.scrollIntoView({ block: 'nearest' })
  }

  private keydown(event: KeyboardEvent): void {
    if (event.target !== this.input || this.list.hidden || !this.matches.length) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      this.selected = (this.selected + (event.key === 'ArrowDown' ? 1 : -1) + this.matches.length) % this.matches.length
      this.highlight()
    } else if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
      if (event.isComposing) return
      this.pick(this.selected)
    } else if (event.key === 'Escape') {
      this.close()
    } else return
    event.preventDefault()
    event.stopPropagation()
  }

  private pick(index: number): void {
    const user = this.matches[index]
    const query = this.query
    if (!user || !query) return
    const value = this.input.value
    const end = query.start + 1 + query.query.length
    const after = value.slice(end)
    const insert = `@${user.username}${after.startsWith(' ') ? '' : ' '}`
    this.input.value = value.slice(0, query.start) + insert + after
    const caret = query.start + insert.length + (after.startsWith(' ') ? 1 : 0)
    this.input.setSelectionRange(caret, caret)
    this.close()
    this.input.dispatchEvent(new Event('input'))
    this.input.focus()
  }
}
