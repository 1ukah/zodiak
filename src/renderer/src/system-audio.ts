import { pcmWorkletSource } from './system-audio-processor'

let context: AudioContext | null = null
let node: AudioWorkletNode | null = null
let track: MediaStreamTrack | null = null
let unsubscribe: (() => void) | null = null

export async function openSystemAudioTrack(excludeDiscord: boolean): Promise<MediaStreamTrack> {
  await closeSystemAudio()
  context = new AudioContext({ sampleRate: 48000 })
  const url = URL.createObjectURL(new Blob([pcmWorkletSource], { type: 'text/javascript' }))
  try { await context.audioWorklet.addModule(url) } finally { URL.revokeObjectURL(url) }
  node = new AudioWorkletNode(context, 'system-audio-pcm', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] })
  const destination = context.createMediaStreamDestination(); node.connect(destination)
  unsubscribe = window.sharescreen.onSystemAudio((pcm) => {
    const copy = new Uint8Array(pcm.byteLength); copy.set(pcm); node?.port.postMessage(copy.buffer, [copy.buffer])
  })
  const started = await window.sharescreen.startSystemAudio(excludeDiscord)
  if (!started.ok) { await closeSystemAudio(); throw new Error(started.error) }
  track = destination.stream.getAudioTracks()[0] ?? null
  if (!track) { await closeSystemAudio(); throw new Error('System audio did not start') }
  if (context.state === 'suspended') await context.resume()
  return track
}

export async function closeSystemAudio(): Promise<void> {
  unsubscribe?.(); unsubscribe = null; node?.disconnect(); node = null; track?.stop(); track = null
  const current = context; context = null
  await Promise.all([
    current && current.state !== 'closed' ? current.close().catch(() => undefined) : undefined,
    window.sharescreen?.stopSystemAudio(),
  ])
}
