import type { Channel, GatewayEvent, GuildSnapshot, Id, Member, Message, User, VoiceChannelState } from '../../../shared/protocol'

export interface ChannelHistory {
  /** Oldest first. */
  messages: Message[]
  /** True when the oldest message of the channel is loaded. */
  complete: boolean
}

export type StoreChange =
  | { kind: 'all' }
  | { kind: 'guilds' }
  | { kind: 'messages'; channelId: Id }

function byPosition(a: Channel, b: Channel): number {
  return a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

/** Compares two IDs as 64-bit numbers. IDs are strings in JSON. */
export function compareIds(a: Id, b: Id): number {
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0)
}

/** Client state built from READY and kept current by live events. */
export class ZodiakStore {
  user: User | null = null
  guilds: GuildSnapshot[] = []
  /** Voice channels with participants, by channel. */
  voice = new Map<Id, VoiceChannelState>()
  /** Users who share a server with this user and are online, including this user. */
  online = new Set<Id>()
  private histories = new Map<Id, ChannelHistory>()
  private listeners = new Set<(change: StoreChange) => void>()

  subscribe(listener: (change: StoreChange) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(change: StoreChange): void {
    for (const listener of this.listeners) listener(change)
  }

  reset(): void {
    this.user = null
    this.guilds = []
    this.voice.clear()
    this.online.clear()
    this.histories.clear()
    this.emit({ kind: 'all' })
  }

  isOnline(userId: Id): boolean {
    return userId === this.user?.id || this.online.has(userId)
  }

  /** Display name of a server member, or `undefined` when the user is not a member. */
  memberName(guildId: Id, userId: Id): string | undefined {
    return this.guild(guildId)?.members.find((m) => m.user.id === userId)?.user.display_name
  }

  guild(id: Id | null): GuildSnapshot | undefined {
    return id ? this.guilds.find((g) => g.guild.id === id) : undefined
  }

  channel(id: Id | null): Channel | undefined {
    if (!id) return undefined
    for (const g of this.guilds) {
      const channel = g.channels.find((c) => c.id === id)
      if (channel) return channel
    }
    return undefined
  }

  isOwner(guildId: Id | null): boolean {
    return Boolean(this.user && this.guild(guildId)?.guild.owner_id === this.user.id)
  }

  history(channelId: Id): ChannelHistory | undefined {
    return this.histories.get(channelId)
  }

  /** Adds a page of older messages (any order) from the HTTP API. */
  addOlder(channelId: Id, page: Message[], limit: number): void {
    const history = this.histories.get(channelId) ?? { messages: [], complete: false }
    const known = new Set(history.messages.map((m) => m.id))
    const older = page.filter((m) => !known.has(m.id)).sort((a, b) => compareIds(a.id, b.id))
    history.messages = [...older, ...history.messages]
    history.complete = page.length < limit
    this.histories.set(channelId, history)
    this.emit({ kind: 'messages', channelId })
  }

  /** Adds or replaces one message, for example the answer to a send request. */
  upsertMessage(message: Message): void {
    const history = this.histories.get(message.channel_id)
    if (!history) return
    const index = history.messages.findIndex((m) => m.id === message.id)
    if (index >= 0) history.messages[index] = { ...message, nonce: undefined }
    else {
      history.messages.push({ ...message, nonce: undefined })
      history.messages.sort((a, b) => compareIds(a.id, b.id))
    }
    this.emit({ kind: 'messages', channelId: message.channel_id })
  }

  apply(event: GatewayEvent): void {
    switch (event.t) {
      case 'READY':
        // Messages may have been missed while disconnected, so cached history is dropped.
        this.user = event.d.user
        this.guilds = event.d.guilds.map((g) => ({ ...g, channels: [...g.channels].sort(byPosition) }))
        this.voice = new Map(event.d.voice_states.map((state) => [state.channel_id, state]))
        this.online = new Set(event.d.online)
        this.histories.clear()
        this.emit({ kind: 'all' })
        return
      case 'PRESENCE_UPDATE':
        if (event.d.online) this.online.add(event.d.user_id)
        else this.online.delete(event.d.user_id)
        this.emit({ kind: 'guilds' })
        return
      case 'VOICE_STATE_UPDATE':
        if (event.d.participants.length) this.voice.set(event.d.channel_id, event.d)
        else this.voice.delete(event.d.channel_id)
        this.emit({ kind: 'guilds' })
        return
      case 'USER_UPDATE':
        this.updateUser(event.d)
        return
      case 'GUILD_CREATE': {
        const snapshot = { ...event.d, channels: [...event.d.channels].sort(byPosition) }
        const index = this.guilds.findIndex((g) => g.guild.id === snapshot.guild.id)
        if (index >= 0) this.guilds[index] = snapshot
        else this.guilds.push(snapshot)
        this.emit({ kind: 'guilds' })
        return
      }
      case 'GUILD_UPDATE': {
        const snapshot = this.guild(event.d.id)
        if (snapshot) snapshot.guild = event.d
        this.emit({ kind: 'guilds' })
        return
      }
      case 'GUILD_DELETE': {
        const snapshot = this.guild(event.d.id)
        snapshot?.channels.forEach((c) => { this.histories.delete(c.id); this.voice.delete(c.id) })
        this.guilds = this.guilds.filter((g) => g.guild.id !== event.d.id)
        this.emit({ kind: 'guilds' })
        return
      }
      case 'CHANNEL_CREATE':
      case 'CHANNEL_UPDATE': {
        const snapshot = this.guild(event.d.guild_id)
        if (!snapshot) return
        snapshot.channels = [...snapshot.channels.filter((c) => c.id !== event.d.id), event.d].sort(byPosition)
        this.emit({ kind: 'guilds' })
        return
      }
      case 'CHANNEL_DELETE': {
        const snapshot = this.guild(event.d.guild_id)
        if (snapshot) snapshot.channels = snapshot.channels.filter((c) => c.id !== event.d.id)
        this.histories.delete(event.d.id)
        this.emit({ kind: 'guilds' })
        return
      }
      case 'MEMBER_ADD': {
        const snapshot = this.guild(event.d.guild_id)
        if (snapshot && !snapshot.members.some((m) => m.user.id === event.d.member.user.id)) {
          snapshot.members.push(event.d.member)
          this.emit({ kind: 'guilds' })
        }
        return
      }
      case 'MEMBER_REMOVE': {
        const snapshot = this.guild(event.d.guild_id)
        if (snapshot) snapshot.members = snapshot.members.filter((m: Member) => m.user.id !== event.d.user_id)
        this.emit({ kind: 'guilds' })
        return
      }
      case 'MESSAGE_CREATE':
      case 'MESSAGE_UPDATE':
        this.upsertMessage(event.d)
        return
      case 'MESSAGE_DELETE': {
        const history = this.histories.get(event.d.channel_id)
        if (!history) return
        history.messages = history.messages.filter((m) => m.id !== event.d.id)
        this.emit({ kind: 'messages', channelId: event.d.channel_id })
      }
    }
  }

  private updateUser(user: User): void {
    if (this.user?.id === user.id) this.user = user
    for (const g of this.guilds) {
      for (const member of g.members) if (member.user.id === user.id) member.user = user
    }
    for (const [channelId, history] of this.histories) {
      let changed = false
      for (const message of history.messages) {
        if (message.author.id === user.id) { message.author = user; changed = true }
      }
      if (changed) this.emit({ kind: 'messages', channelId })
    }
    this.emit({ kind: 'guilds' })
  }
}
