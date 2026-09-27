const source = `
class Pcm extends AudioWorkletProcessor {
  constructor() { super(); this.q=[]; this.n=0; this.port.onmessage=e=>{const a=new Int16Array(e.data); this.q.push(a); this.n+=a.length} }
  process(_, out) { const l=out[0][0], r=out[0][1]; for(let i=0;i<l.length;i++){ if(this.n<2){l[i]=r[i]=0;continue} let a=this.q[0]; l[i]=a[0]/32768;r[i]=a[1]/32768; if(a.length===2)this.q.shift();else this.q[0]=a.subarray(2);this.n-=2 } return true }
} registerProcessor('system-audio-pcm', Pcm)`

let context: AudioContext | null = null
let node: AudioWorkletNode | null = null
let track: MediaStreamTrack | null = null
let unsubscribe: (() => void) | null = null

export async function openSystemAudioTrack(excludeDiscord: boolean): Promise<MediaStreamTrack> {
  await closeSystemAudio()
  context = new AudioContext({ sampleRate: 48000 })
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
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
  if (current && current.state !== 'closed') await current.close().catch(() => undefined)
  if (window.sharescreen) await window.sharescreen.stopSystemAudio()
}
