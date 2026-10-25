/**
 * LiveKit hints the bandwidth estimator with `x-google-start-bitrate` (90% of a
 * screen share's cap), but the hint never takes effect:
 *  - it is only added to the local offer, while libwebrtc takes the send side's
 *    start bitrate from the negotiated codec in the remote answer, and
 *  - it is only added to the first payload of the codec (e.g. H.264 profile
 *    42001f), while the server may select another payload of the same codec.
 * Measured with a local server, every share started at the 300 kbps default
 * and, with "Prioritize: Framerate", at 480x270, needing ~15 s to reach 1080p.
 *
 * Copy the offer's start bitrate into the answer for every payload of the same
 * codec. Every video section gets it, which keeps bundled payload parameters
 * identical (libwebrtc rejects a "bundled payload type collision").
 */
export function copyStartBitrate(localSdp: string, remoteSdp: string): string {
  const localCodecs = payloadCodecs(localSdp)
  const starts = new Map<string, string>()
  for (const match of localSdp.matchAll(/^a=fmtp:(\d+) [^\r\n]*x-google-start-bitrate=(\d+)/gm)) {
    const codec = localCodecs.get(match[1])
    if (codec && !starts.has(codec)) starts.set(codec, match[2])
  }
  if (!starts.size) return remoteSdp
  const newline = remoteSdp.includes('\r\n') ? '\r\n' : '\n'
  return remoteSdp.split(/(?=^m=)/m).map(section => {
    if (!section.startsWith('m=video')) return section
    const codecs = payloadCodecs(section)
    const lines = section.split(newline)
    const out: string[] = []
    for (const line of lines) {
      const fmtp = /^a=fmtp:(\d+) (.*)$/.exec(line)
      const start = fmtp && starts.get(codecs.get(fmtp[1]) ?? '')
      if (start && !fmtp[2].includes('x-google-start-bitrate')) {
        out.push(`${line};x-google-start-bitrate=${start}`)
        continue
      }
      out.push(line)
      // Codecs such as VP8 may have no fmtp line at all.
      const rtpmap = /^a=rtpmap:(\d+) /.exec(line)
      const missing = rtpmap && starts.get(codecs.get(rtpmap[1]) ?? '')
      if (missing && !lines.some(other => other.startsWith(`a=fmtp:${rtpmap[1]} `))) out.push(`a=fmtp:${rtpmap[1]} x-google-start-bitrate=${missing}`)
    }
    return out.join(newline)
  }).join('')
}

function payloadCodecs(sdp: string): Map<string, string> {
  const codecs = new Map<string, string>()
  for (const match of sdp.matchAll(/^a=rtpmap:(\d+) ([^/\s]+)\//gm)) codecs.set(match[1], match[2].toUpperCase())
  return codecs
}

let installed = false

/** Applies `copyStartBitrate` to every answer this renderer receives. */
export function installStartBitrateFix(): void {
  if (installed || typeof RTCPeerConnection === 'undefined') return
  installed = true
  const original = RTCPeerConnection.prototype.setRemoteDescription
  RTCPeerConnection.prototype.setRemoteDescription = function (this: RTCPeerConnection, description?: RTCSessionDescriptionInit, ...rest: unknown[]) {
    const local = this.localDescription?.sdp
    if (description?.type === 'answer' && description.sdp && local) {
      const sdp = copyStartBitrate(local, description.sdp)
      if (sdp !== description.sdp) description = { type: 'answer', sdp }
    }
    return (original as (...args: unknown[]) => Promise<void>).call(this, description, ...rest)
  } as typeof original
}
