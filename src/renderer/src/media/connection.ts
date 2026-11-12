import type { MediaParticipant, MediaServerFrame, PublishedTrack, SubscribedTrack, TrackSource } from '../../../shared/protocol'

export interface RemoteTrack {
  userId: string
  source: TrackSource
  track: MediaStreamTrack
  receiver: RTCRtpReceiver
}

export interface ConnectionEvents {
  onParticipants: (participants: MediaParticipant[]) => void
  onTracks: (tracks: RemoteTrack[]) => void
  onClosed: (reason: string) => void
}

export interface ScreenSettings {
  maxBitrate: number
  maxFramerate: number
  degradationPreference: RTCDegradationPreference
}

const MIC_BITRATE = 64_000
const SCREEN_AUDIO_BITRATE = 128_000
const CONNECT_TIMEOUT_MS = 20_000

function isStopped(transceiver: RTCRtpTransceiver): boolean {
  return transceiver.direction === 'stopped' || transceiver.currentDirection === 'stopped'
}

/** Opus in stereo, so screen audio keeps both channels. */
export function stereoOpus(sdp: string): string {
  const opus = new Set([...sdp.matchAll(/^a=rtpmap:(\d+) opus\/48000\/2/gim)].map((m) => m[1]))
  return sdp.replace(/^a=fmtp:(\d+) (.*)$/gm, (line, pt: string, params: string) => {
    if (!opus.has(pt)) return line
    const extra = ['stereo=1', 'sprop-stereo=1'].filter((p) => !params.includes(p.split('=')[0] + '='))
    return extra.length ? `a=fmtp:${pt} ${params};${extra.join(';')}` : line
  })
}

/** H.264 only. Baseline profile with packetization mode 1 first: every decoder supports it. */
export function h264Codecs(codecs: RTCRtpCodec[]): RTCRtpCodec[] {
  const h264 = codecs.filter((c) => c.mimeType.toLowerCase() === 'video/h264')
  const rank = (c: RTCRtpCodec) => (c.sdpFmtpLine?.includes('packetization-mode=1') ? 0 : 2) + (c.sdpFmtpLine?.includes('profile-level-id=42e0') ? 0 : 1)
  return [...h264].sort((a, b) => rank(a) - rank(b))
}

/**
 * Two WebRTC connections to zodiak-media: the publisher sends (this client offers) and
 * the subscriber receives (the server offers). Signaling goes through the main process.
 */
export class MediaConnection {
  readonly publisher = new RTCPeerConnection({ bundlePolicy: 'max-bundle', rtcpMuxPolicy: 'require' })
  readonly subscriber = new RTCPeerConnection({ bundlePolicy: 'max-bundle', rtcpMuxPolicy: 'require' })
  private readonly microphone: RTCRtpTransceiver
  private screenVideo: RTCRtpTransceiver | null = null
  private screenAudio: RTCRtpTransceiver | null = null
  private trackMap = new Map<string, SubscribedTrack>()
  private publishQueue: Promise<void> = Promise.resolve()
  private subscribeQueue: Promise<void> = Promise.resolve()
  private publishAnswer: ((sdp: string) => void) | null = null
  private unsubscribe: Array<() => void> = []
  private closed = false
  userId = ''

  constructor(private readonly events: ConnectionEvents) {
    this.microphone = this.publisher.addTransceiver('audio', { direction: 'sendonly', sendEncodings: [{ maxBitrate: MIC_BITRATE }] })
    this.subscriber.addEventListener('track', () => this.emitTracks())
    for (const pc of [this.publisher, this.subscriber]) {
      pc.addEventListener('connectionstatechange', () => {
        if (pc.connectionState === 'failed') this.fail('The voice connection was lost.')
      })
    }
  }

  async open(channelId: string): Promise<void> {
    const media = window.zodiak.media
    let joined: (participants: MediaParticipant[]) => void = () => undefined
    const joinedPromise = new Promise<MediaParticipant[]>((resolve, reject) => {
      joined = resolve
      this.abortOpen = (reason) => reject(new Error(reason))
    })
    this.unsubscribe.push(
      media.onFrame((frame) => this.handle(frame, joined)),
      media.onClosed((reason) => this.fail(reason)),
    )
    const result = await media.connect(channelId)
    if (!result.ok) { this.close(); throw new Error(result.error) }
    this.events.onParticipants(await joinedPromise)
    this.abortOpen = null
    await this.renegotiate()
    await this.waitConnected()
  }

  private abortOpen: ((reason: string) => void) | null = null

  private handle(frame: MediaServerFrame, joined: (participants: MediaParticipant[]) => void): void {
    if (this.closed) return
    switch (frame.op) {
      case 'joined':
        this.userId = frame.user_id
        joined(frame.participants)
        return
      case 'participants':
        this.events.onParticipants(frame.participants)
        return
      case 'publish_answer':
        this.publishAnswer?.(frame.sdp)
        this.publishAnswer = null
        return
      case 'subscribe_offer':
        this.subscribeQueue = this.subscribeQueue.then(() => this.acceptOffer(frame.sdp, frame.tracks)).catch((error: unknown) => {
          this.fail(`Could not receive media: ${error instanceof Error ? error.message : String(error)}`)
        })
        return
      case 'error':
        this.fail(frame.message)
    }
  }

  private async acceptOffer(sdp: string, tracks: SubscribedTrack[]): Promise<void> {
    if (this.closed) return
    await this.subscriber.setRemoteDescription({ type: 'offer', sdp })
    const answer = await this.subscriber.createAnswer()
    const munged = { type: answer.type, sdp: stereoOpus(answer.sdp ?? '') }
    await this.subscriber.setLocalDescription(munged)
    window.zodiak.media.send({ op: 'subscribe_answer', sdp: munged.sdp })
    this.trackMap = new Map(tracks.map((t) => [t.mid, t]))
    this.emitTracks()
  }

  private emitTracks(): void {
    const tracks: RemoteTrack[] = []
    for (const transceiver of this.subscriber.getTransceivers()) {
      const mapped = transceiver.mid ? this.trackMap.get(transceiver.mid) : undefined
      if (!mapped || isStopped(transceiver) || transceiver.currentDirection === 'inactive') continue
      tracks.push({ userId: mapped.user_id, source: mapped.source, track: transceiver.receiver.track, receiver: transceiver.receiver })
    }
    this.events.onTracks(tracks)
  }

  /** Publisher negotiation. Calls are queued, so only one offer is open at a time. */
  renegotiate(): Promise<void> {
    const run = async () => {
      if (this.closed) return
      const offer = await this.publisher.createOffer()
      await this.publisher.setLocalDescription(offer)
      const tracks: PublishedTrack[] = []
      const add = (transceiver: RTCRtpTransceiver | null, source: TrackSource) => {
        if (transceiver?.mid && !isStopped(transceiver)) tracks.push({ mid: transceiver.mid, source })
      }
      add(this.microphone, 'microphone')
      add(this.screenVideo, 'screen')
      add(this.screenAudio, 'screen_audio')
      const answered = new Promise<string>((resolve, reject) => {
        this.publishAnswer = resolve
        setTimeout(() => reject(new Error('The voice server did not answer.')), CONNECT_TIMEOUT_MS)
      })
      window.zodiak.media.send({ op: 'publish', sdp: this.publisher.localDescription?.sdp ?? '', tracks })
      const sdp = await answered
      await this.publisher.setRemoteDescription({ type: 'answer', sdp: stereoOpus(sdp) })
    }
    const result = this.publishQueue.then(run)
    this.publishQueue = result.catch(() => undefined)
    return result
  }

  private waitConnected(): Promise<void> {
    return new Promise((resolve, reject) => {
      const check = () => {
        if (this.closed) { reject(new Error('The voice connection closed.')); return true }
        if (this.publisher.connectionState === 'connected' && this.subscriber.connectionState === 'connected') { resolve(); return true }
        return false
      }
      if (check()) return
      const timer = setInterval(() => { if (check()) clearInterval(timer) }, 50)
      setTimeout(() => { clearInterval(timer); if (!check()) reject(new Error('Could not connect to the voice server.')) }, CONNECT_TIMEOUT_MS)
    })
  }

  async setMicrophone(track: MediaStreamTrack | null): Promise<void> {
    await this.microphone.sender.replaceTrack(track)
  }

  sendState(muted: boolean, deafened: boolean, voiceEnabled: boolean): void {
    window.zodiak.media.send({ op: 'state', muted, deafened, voice_enabled: voiceEnabled })
  }

  watch(userId: string, watching: boolean): void {
    window.zodiak.media.send({ op: 'watch', user_id: userId, watching })
  }

  get screenSender(): RTCRtpSender | null {
    return this.screenVideo && !isStopped(this.screenVideo) ? this.screenVideo.sender : null
  }

  async startScreen(video: MediaStreamTrack, audio: MediaStreamTrack | null, settings: ScreenSettings): Promise<void> {
    await this.stopScreen(false)
    const transceiver = this.publisher.addTransceiver(video, {
      direction: 'sendonly',
      sendEncodings: [{ maxBitrate: settings.maxBitrate, maxFramerate: settings.maxFramerate, priority: 'high', networkPriority: 'high' }],
    })
    const capabilities = RTCRtpSender.getCapabilities('video')
    const codecs = capabilities ? h264Codecs(capabilities.codecs) : []
    if (!codecs.length) throw new Error('This computer cannot send H.264 video.')
    transceiver.setCodecPreferences(codecs)
    this.screenVideo = transceiver
    if (audio) {
      this.screenAudio = this.publisher.addTransceiver(audio, { direction: 'sendonly', sendEncodings: [{ maxBitrate: SCREEN_AUDIO_BITRATE }] })
    }
    await this.renegotiate()
    const parameters = transceiver.sender.getParameters()
    parameters.degradationPreference = settings.degradationPreference
    await transceiver.sender.setParameters(parameters).catch(() => undefined)
  }

  async stopScreen(renegotiate = true): Promise<void> {
    const had = Boolean(this.screenVideo || this.screenAudio)
    for (const transceiver of [this.screenVideo, this.screenAudio]) {
      if (!transceiver || isStopped(transceiver)) continue
      transceiver.sender.track?.stop()
      transceiver.stop()
    }
    this.screenVideo = null
    this.screenAudio = null
    if (had && renegotiate && !this.closed) await this.renegotiate()
  }

  private fail(reason: string): void {
    if (this.closed) return
    this.abortOpen?.(reason)
    this.abortOpen = null
    this.close()
    this.events.onClosed(reason)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.publishAnswer = null
    for (const stop of this.unsubscribe) stop()
    this.unsubscribe = []
    void window.zodiak.media.disconnect()
    this.publisher.close()
    this.subscriber.close()
  }
}
