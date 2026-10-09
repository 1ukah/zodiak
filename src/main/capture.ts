import { desktopCapturer, session, type DesktopCapturerSource } from 'electron'
import { PORTAL_SOURCE_ID, type DesktopSourceInfo, type ShareRequest } from '../shared/types'
import { getPlatformCapabilities } from './platform'

interface PendingShare {
  sourceId: string
  generation: number
}

let pending: PendingShare | null = null
let generation = 0

export function validateCaptureRequest(request: ShareRequest): void {
  const capabilities = getPlatformCapabilities()
  if (request.withAudio && !capabilities.systemAudioCapture) throw new Error('System audio sharing is not available on this platform')
  if (request.blockDiscordAudio && !capabilities.discordAudioExclusion) throw new Error('Discord audio exclusion is not available on this platform')
  if (capabilities.capturePicker === 'portal' && request.sourceId !== PORTAL_SOURCE_ID) throw new Error('Choose a screen or window with the desktop picker')
  if (capabilities.capturePicker !== 'portal' && request.sourceId === PORTAL_SOURCE_ID) throw new Error('Choose a screen or window')
}

export function cancelCapture(): void {
  generation++
  pending = null
}

export function registerCaptureHandler(): void {
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    const current = pending
    pending = null
    if (!current || !request.videoRequested) {
      callback({})
      return
    }
    void desktopCapturer
      .getSources({ types: current.sourceId === PORTAL_SOURCE_ID ? ['screen', 'window'] : [current.sourceId.startsWith('screen:') ? 'screen' : 'window'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false })
      .then((sources) => {
        const match = current.sourceId === PORTAL_SOURCE_ID ? sources[0] : sources.find((source) => source.id === current.sourceId)
        if (!match || current.generation !== generation) {
          callback({})
          return
        }
        callback({
          // Keep the portal source intact. Screen audio is published separately
          // by the Windows helper, never by display-media loopback.
          video: match,
        })
      })
      .catch(() => {
        callback({})
      })
  })
}

export function armCapture(request: ShareRequest): void {
  validateCaptureRequest(request)
  pending = { sourceId: request.sourceId, generation: ++generation }
}

export async function listSources(): Promise<DesktopSourceInfo[]> {
  // Opening the quality dialog must not open a Wayland consent dialog.
  if (getPlatformCapabilities().capturePicker === 'portal') return []
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 360, height: 202 },
    fetchWindowIcons: false,
  })
  return sources
    .filter((source) => !isOwnWindow(source.name))
    .sort(compareSources)
    .map(toInfo)
}

function isOwnWindow(name: string): boolean {
  return name === 'zodiak' || name.startsWith('zodiak')
}

function compareSources(a: DesktopCapturerSource, b: DesktopCapturerSource): number {
  const rank = (source: DesktopCapturerSource): number => (source.id.startsWith('screen:') ? 0 : 1)
  const byKind = rank(a) - rank(b)
  if (byKind !== 0) return byKind
  return a.name.localeCompare(b.name)
}

function toInfo(source: DesktopCapturerSource): DesktopSourceInfo {
  return {
    id: source.id,
    name: source.name || 'Window',
    thumbnail: source.thumbnail.isEmpty() ? '' : source.thumbnail.toDataURL(),
  }
}
