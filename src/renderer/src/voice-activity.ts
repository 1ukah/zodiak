// Activity follows audible output rather than the capture or gate-open flag.
// -70 dBFS picks up quiet filtered speech; a lower release threshold avoids
// flicker. Exact silence clears immediately, without another gate-like tail.
const START_RMS = 10 ** (-70 / 20)
const KEEP_RMS = 10 ** (-76 / 20)
const SILENCE_RMS = 1e-7
const HOLD_MS = 100

export function voiceActiveUntil(rms: number, previous: number, now: number): number {
  if (!Number.isFinite(rms) || rms <= SILENCE_RMS) return 0
  if (rms >= START_RMS || (previous > now && rms >= KEEP_RMS)) return now + HOLD_MS
  return previous > now ? previous : 0
}
