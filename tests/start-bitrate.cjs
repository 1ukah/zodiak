// The publisher's start-bitrate hint must reach the answer for the codec the server selected.
const assert = require('node:assert/strict')
const vm = require('node:vm')
const path = require('node:path')
const { build } = require('./build-renderer.cjs')

const sdp = lines => lines.join('\r\n') + '\r\n'
// Chrome offers several H.264 payloads; LiveKit hints only the first (102).
const offer = sdp([
  'v=0', 'a=group:BUNDLE 0 1 2',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111', 'a=mid:0', 'a=rtpmap:111 opus/48000/2', 'a=fmtp:111 minptime=10;useinbandfec=1',
  'm=video 9 UDP/TLS/RTP/SAVPF 96 97 102 108 114', 'a=mid:1',
  'a=rtpmap:96 VP8/90000', 'a=rtpmap:97 rtx/90000', 'a=fmtp:97 apt=96',
  'a=rtpmap:102 H264/90000', 'a=fmtp:102 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42001f;x-google-start-bitrate=10800',
  'a=rtpmap:108 H264/90000', 'a=fmtp:108 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f',
  'a=rtpmap:114 H264/90000', 'a=fmtp:114 level-asymmetry-allowed=1;packetization-mode=0;profile-level-id=42e01f',
  'm=video 9 UDP/TLS/RTP/SAVPF 108', 'a=mid:2', 'a=rtpmap:108 H264/90000', 'a=fmtp:108 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f',
])
// The server selected 108/114 and two bundled video sections share them.
const answer = sdp([
  'v=0', 'a=group:BUNDLE 0 1 2',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111', 'a=mid:0', 'a=rtpmap:111 opus/48000/2', 'a=fmtp:111 minptime=10;useinbandfec=1',
  'm=video 9 UDP/TLS/RTP/SAVPF 108 109 114', 'a=mid:1',
  'a=rtpmap:108 H264/90000', 'a=fmtp:108 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f',
  'a=rtpmap:109 rtx/90000', 'a=fmtp:109 apt=108',
  'a=rtpmap:114 H264/90000', 'a=fmtp:114 level-asymmetry-allowed=1;packetization-mode=0;profile-level-id=42e01f',
  'm=video 9 UDP/TLS/RTP/SAVPF 108', 'a=mid:2', 'a=rtpmap:108 H264/90000', 'a=fmtp:108 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f',
])

async function main() {
  const built = await build({ entryPoints: [path.join(__dirname, '../src/renderer/src/start-bitrate.ts')], bundle: true, platform: 'node', format: 'cjs', write: false })
  const module = { exports: {} }
  vm.runInNewContext(built.outputFiles[0].text, { module, exports: module.exports, require })
  const { copyStartBitrate } = module.exports

  const munged = copyStartBitrate(offer, answer)
  const h264 = munged.split('\r\n').filter(line => /^a=fmtp:(108|114) /.test(line))
  assert.equal(h264.length, 3)
  assert(h264.every(line => line.endsWith(';x-google-start-bitrate=10800')), 'Every H.264 payload the server selected gets the offer\'s start bitrate, in every bundled section')
  console.log('PASS The start bitrate follows the codec, not the payload number LiveKit hinted')
  assert(munged.includes('a=fmtp:109 apt=108\r\n') && munged.includes('a=fmtp:111 minptime=10;useinbandfec=1\r\n'), 'RTX and audio parameters stay unchanged')
  assert(munged.endsWith('\r\n') && !munged.includes('\r\n\r\n'), 'Line structure is preserved')
  console.log('PASS RTX, audio, and SDP line structure are untouched')
  assert.equal(copyStartBitrate(offer, munged), munged, 'Applying twice does not duplicate the parameter')
  assert.equal(copyStartBitrate(offer.replace(';x-google-start-bitrate=10800', ''), answer), answer, 'Without a hint the answer is unchanged')
  console.log('PASS Idempotent, and a no-op without a hint')

  const vp8Offer = sdp(['v=0', 'm=video 9 UDP/TLS/RTP/SAVPF 96', 'a=mid:0', 'a=rtpmap:96 VP8/90000', 'a=fmtp:96 x-google-start-bitrate=4000'])
  const vp8Answer = sdp(['v=0', 'm=video 9 UDP/TLS/RTP/SAVPF 96', 'a=mid:0', 'a=rtpmap:96 VP8/90000', 'a=rtcp-fb:96 nack'])
  assert(copyStartBitrate(vp8Offer, vp8Answer).includes('a=rtpmap:96 VP8/90000\r\na=fmtp:96 x-google-start-bitrate=4000\r\n'), 'A codec without an fmtp line gets one')
  console.log('PASS Codecs without fmtp lines receive the hint')
}

main().catch(error => { console.error(error); process.exit(1) })
