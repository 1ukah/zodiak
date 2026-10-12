import { pcmWorkletSource } from './system-audio-processor'

interface AudioCapture {
  context: AudioContext
  node?: AudioWorkletNode
  track?: MediaStreamTrack
  unsubscribe?: () => void
  unsubscribeError?: () => void
  error?: string
}
let capture: AudioCapture | null = null
let generation = 0

export async function openSystemAudioTrack(excludeDiscord: boolean, onError?: (message: string) => void): Promise<MediaStreamTrack> {
  const request = ++generation
  await cleanup()
  if (request !== generation) throw new Error('System audio capture cancelled')
  const current: AudioCapture = { context: new AudioContext({ sampleRate: 48000 }) }
  capture = current
  const check = (): void => {
    if (capture !== current || request !== generation) throw new Error('System audio capture cancelled')
    if (current.error) throw new Error(current.error)
  }
  let opened = false
  try {
    const url = URL.createObjectURL(new Blob([pcmWorkletSource], { type: 'text/javascript' }))
    try { await current.context.audioWorklet.addModule(url) } finally { URL.revokeObjectURL(url) }
    check()
    const node = new AudioWorkletNode(current.context, 'system-audio-pcm', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] })
    current.node = node
    const destination = current.context.createMediaStreamDestination()
    node.connect(destination)
    current.track = destination.stream.getAudioTracks()[0]
    if (!current.track) throw new Error('System audio did not start')
    current.unsubscribe = window.sharescreen.onSystemAudio((pcm) => {
      if (capture !== current) return
      const copy = new Uint8Array(pcm.byteLength); copy.set(pcm)
      node.port.postMessage(copy.buffer, [copy.buffer])
    })
    current.unsubscribeError = window.sharescreen.onSystemAudioError?.((message) => {
      if (capture !== current) return
      current.error = message
      current.track?.stop()
      if (opened) onError?.(message)
    })
    const started = await window.sharescreen.startSystemAudio(excludeDiscord)
    check()
    if (!started.ok) throw new Error(started.error)
    if (current.context.state === 'suspended') await current.context.resume()
    check()
    opened = true
    return current.track
  } catch (error) {
    if (capture === current) await cleanup()
    throw error
  }
}

async function cleanup(): Promise<void> {
  const current = capture
  capture = null
  current?.unsubscribe?.(); current?.unsubscribeError?.()
  current?.node?.disconnect(); current?.track?.stop()
  await Promise.all([
    current && current.context.state !== 'closed' ? current.context.close().catch(() => undefined) : undefined,
    window.sharescreen?.stopSystemAudio(),
  ])
}

export async function closeSystemAudio(): Promise<void> {
  generation++
  await cleanup()
}
