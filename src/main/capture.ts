import { desktopCapturer, session, type DesktopCapturerSource } from 'electron'
import type { DesktopSourceInfo, ShareRequest } from '../shared/types'

interface PendingShare {
  sourceId: string
  withAudio: boolean
}

let pending: PendingShare | null = null

export function registerCaptureHandler(): void {
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    const current = pending
    pending = null
    if (!current || !request.videoRequested) {
      callback({})
      return
    }
    void desktopCapturer
      .getSources({ types: [current.sourceId.startsWith('screen:') ? 'screen' : 'window'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false })
      .then((sources) => {
        const match = sources.find((source) => source.id === current.sourceId)
        if (!match) {
          callback({})
          return
        }
        callback({
          video: { id: match.id, name: match.name },
          // Electron's Chromium capture path provides system loopback audio. It is
          // intentionally used instead of a separately compiled Windows helper.
          audio: current.withAudio && request.audioRequested ? 'loopback' : undefined,
        })
      })
      .catch(() => {
        callback({})
      })
  })
}

export function armCapture(request: ShareRequest): void {
  pending = { sourceId: request.sourceId, withAudio: request.withAudio }
}

export async function listSources(): Promise<DesktopSourceInfo[]> {
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
