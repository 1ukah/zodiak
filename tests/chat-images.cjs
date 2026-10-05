// Exercise production chat transport with a deterministic room and the SDK's
// actual byte-stream reader, including interrupted transfers and private routing.
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')
const { EventEmitter } = require('node:events')
const { build } = require('./build-renderer.cjs')
const sdk = require('livekit-client')
const root = path.resolve(__dirname, '..')
const compile = (code, load = require) => {
  const module = new Module(path.join(__dirname, 'chat-images-compiled.cjs'))
  module.require = load; module._compile(code, module.id); return module.exports
}
const tick = () => new Promise(resolve => setTimeout(resolve, 10))
let current, failWrite = false, interruptSend = false
class Room extends EventEmitter {
  constructor() {
    super(); current = this; this.state = sdk.ConnectionState.Disconnected
    this.handlers = new Map(); this.sent = []; this.data = []
    this.remoteParticipants = new Map([['bob', { identity: 'bob', name: 'Bob', attributes: {}, trackPublications: new Map() }]])
    this.localParticipant = { identity: 'me', name: 'Alice', attributes: {}, getTrackPublication() {}, async setAttributes() {},
      publishData: async (data, options) => this.data.push({ data, options }),
      streamBytes: async options => {
        const sent = { options, chunks: [], closed: false }; this.sent.push(sent)
        return { write: async chunk => {
          if (failWrite) throw Error('Transfer failed')
          sent.chunks.push(chunk)
          if (interruptSend) { interruptSend = false; this.changeState(sdk.ConnectionState.Reconnecting) }
        }, close: async () => { sent.closed = true } }
      },
    }
  }
  registerByteStreamHandler(topic, handler) { this.handlers.set(topic, handler) }
  async connect() { this.changeState(sdk.ConnectionState.Connected) }
  async disconnect() { this.changeState(sdk.ConnectionState.Disconnected) }
  changeState(state) { this.state = state; this.emit(sdk.RoomEvent.ConnectionStateChanged, state) }
}
;(async () => {
  global.window = { setInterval, clearInterval }
  const bundled = await build({ entryPoints: [path.join(root, 'src/renderer/src/session.ts')], bundle: true, platform: 'node', format: 'cjs', write: false,
    plugins: [{ name: 'room-fixture', setup(build) { build.onResolve({ filter: /^livekit-client$/ }, () => ({ path: 'livekit-fixture', external: true })) } }] })
  const engine = compile(bundled.outputFiles[0].text, id => id === 'livekit-fixture' ? { ...sdk, Room } : require(id))
  const readerBundle = await build({ entryPoints: [path.join(root, 'node_modules/livekit-client/src/room/data-stream/incoming/StreamReader.ts')], bundle: true, platform: 'node', format: 'cjs', write: false })
  const { ByteStreamReader } = compile(readerBundle.outputFiles[0].text)
  const messages = []
  const join = () => engine.joinRoom({ url: 'ws://fixture', token: 'fixture', subscribe: false,
    media: { video: { srcObject: null, pause() {} }, audioRack: {} },
    hooks: { onChatMessage: message => messages.push(message), onConnection() {}, onViewers() {}, onParticipants() {}, onStreams() {}, onTelemetry() {}, onAudioBlocked() {}, onError() {} } })
  await join()
  const bytes = new Uint8Array(180_000); bytes.set([137,80,78,71,13,10,26,10])
  const file = new File([bytes], 'photo.png', { type: 'image/png' })
  const own = await engine.sendChatMessage('Caption', 'bob', [file])
  const sent = current.sent[0]
  assert.equal(sent.options.topic, 'zodiak.chat.image.v1')
  assert.deepEqual(sent.options.destinationIdentities, ['bob'])
  assert.equal(sent.options.totalSize, file.size); assert.equal(sent.closed, true)
  assert(sent.chunks.length > 1); assert(sent.chunks.every(chunk => chunk.byteLength <= 65536))
  assert.deepEqual(new Uint8Array(await new Blob(sent.chunks).arrayBuffer()), bytes)
  assert.equal(own.images[0].blob, file); assert.equal(own.text, 'Caption'); assert.equal(own.local, true)
  assert.equal(current.data.length, 0)
  await engine.sendChatMessage('', undefined, [file])
  assert.equal(current.sent[1].options.destinationIdentities, undefined)
  const files = Array.from({length:10}, (_, index) => new File([bytes], 'photo-'+index+'.png', {type:'image/png'}))
  const batch = await engine.sendChatMessage('Batch caption', 'bob', files)
  const batchSent = current.sent.at(-1)
  assert.equal(batchSent.options.totalSize, 10*bytes.length)
  assert.deepEqual(JSON.parse(batchSent.options.attributes.message).images.map(image=>image.name), files.map(file=>file.name))
  assert.deepEqual(batch.images.map(image=>image.blob), files)
  assert.deepEqual(new Uint8Array(await new Blob(batchSent.chunks).arrayBuffer()), new Uint8Array(await new Blob(files).arrayBuffer()))
  const streamsBeforeInvalid = current.sent.length
  await assert.rejects(engine.sendChatMessage('', undefined, [...files,file]), /10 images/)
  await assert.rejects(engine.sendChatMessage('', undefined, [file, new File([new Uint8Array(10*1024*1024+1)], 'large.png', {type:'image/png'})]), /10 MB/)
  await assert.rejects(engine.sendChatMessage('', undefined, [file, new File(['fake'], 'fake.png', {type:'image/png'})]), /valid/)
  assert.equal(current.sent.length, streamsBeforeInvalid)
  console.log('PASS Ten ordered images share one stream, caption, and recipient; invalid batches are rejected before sending')
  console.log('PASS Images larger than the text packet limit stream in chunks with caption and private/public routing')

  let sequence = 0
  const incoming = (options = {}) => {
    const packet = { version: 1, id: 'incoming-' + sequence++, text: '', timestamp: Date.now(),
      image: { name: 'received.png', mimeType: 'image/png', size: bytes.length }, ...options.packet }
    const info = { id: packet.id, name: packet.image.name, mimeType: packet.images ? 'application/octet-stream' : packet.image.mimeType, size: packet.images ? packet.images.reduce((sum,image)=>sum+image.size,0) : packet.image.size,
      topic: 'zodiak.chat.image.v1', attributes: { message: JSON.stringify(packet) }, ...options.info }
    const stream = new ReadableStream({ start(controller) {
      if (options.hold) { options.hold.controller = controller; return }
      for (const chunk of options.chunks || [bytes.slice(0, 10000), bytes.slice(10000)]) controller.enqueue({ content: chunk })
      controller.close()
    } })
    const reader = new ByteStreamReader(info, stream, info.size)
    current.handlers.get(info.topic)(reader, { identity: options.sender || 'bob' })
    return { packet, info }
  }
  const first = incoming({ packet: { recipient: 'me', senderName: 'Spoof', senderId: 'spoof' } }); await tick()
  assert.equal(messages.length, 1); assert.equal(messages[0].senderName, 'Bob'); assert.equal(messages[0].senderId, 'bob')
  assert.equal(messages[0].recipient, 'me'); assert.equal(messages[0].text, '')
  assert.deepEqual(new Uint8Array(await messages[0].images[0].blob.arrayBuffer()), bytes)
  incoming({ packet: first.packet }); incoming({ packet: { recipient: 'someone-else' } }); incoming({ sender: 'unknown' })
  incoming({ info: { mimeType: 'text/plain' } }); incoming({ chunks: [bytes.slice(0, 100)] })
  incoming({ chunks: [new Uint8Array(bytes.length + 1)] }); incoming({ chunks: [new Uint8Array(bytes.length)] })
  incoming({ packet: { image: { name: 'bad.svg', mimeType: 'image/svg+xml', size: bytes.length } } })
  await tick(); assert.equal(messages.length, 1)
  console.log('PASS Real SDK reader delivers verified images and rejects forged sender fields, wrong recipients, duplicates, corrupt and incomplete transfers')

  const jpegBytes = new Uint8Array(70_000); jpegBytes.set([255,216,255]); jpegBytes[jpegBytes.length-1]=42
  const incomingBatch = { images:[{name:'one.png',mimeType:'image/png',size:bytes.length},{name:'two.jpg',mimeType:'image/jpeg',size:jpegBytes.length}] }
  const combined = new Uint8Array(bytes.length+jpegBytes.length); combined.set(bytes); combined.set(jpegBytes,bytes.length)
  incoming({packet:incomingBatch,chunks:[combined.slice(0,bytes.length-5),combined.slice(bytes.length-5)]}); await tick()
  assert.equal(messages.length,2); assert.equal(messages[1].images.length,2)
  assert.deepEqual(new Uint8Array(await messages[1].images[0].blob.arrayBuffer()),bytes)
  assert.deepEqual(new Uint8Array(await messages[1].images[1].blob.arrayBuffer()),jpegBytes)
  assert.equal(messages[1].images[1].blob.type,'image/jpeg')
  const corruptBatch=combined.slice();corruptBatch[bytes.length]=0
  incoming({packet:incomingBatch,chunks:[corruptBatch]});incoming({packet:incomingBatch,chunks:[combined.slice(0,-1)]})
  incoming({packet:{images:Array.from({length:11},()=>incomingBatch.images[0])}})
  await tick();assert.equal(messages.length,2)
  console.log('PASS Mixed-format images preserve byte boundaries; corrupt, incomplete, or oversized-count batches never arrive partially')
  const tenReceived = { images:files.map(file=>({name:file.name,mimeType:file.type,size:file.size})) }
  incoming({packet:tenReceived,chunks:[new Uint8Array(await new Blob(files).arrayBuffer())]});await tick()
  assert.equal(messages.at(-1).images.length,10)
  assert.deepEqual(messages.at(-1).images.map(image=>image.name),files.map(file=>file.name))
  const receivedBeforeBudget = messages.length
  const budgetHold = {}
  incoming({hold:budgetHold,packet:{images:Array.from({length:10},()=>({name:'max.png',mimeType:'image/png',size:10*1024*1024}))}})
  incoming();await tick();assert.equal(messages.length,receivedBeforeBudget)
  budgetHold.controller.close();await tick()
  incoming();await tick();assert.equal(messages.length,receivedBeforeBudget+1)
  console.log('PASS Ten images arrive together; incoming transfers share a 100 MB budget that is released after a failed stream')
  const receivedBeforeDisconnect = messages.length
  const hold = {}; incoming({ hold }); await tick()
  current.changeState(sdk.ConnectionState.Reconnecting); current.changeState(sdk.ConnectionState.Connected)
  hold.controller.enqueue({ content: bytes }); hold.controller.close(); await tick()
  assert.equal(messages.length, receivedBeforeDisconnect)
  const leaving = {}; incoming({ hold: leaving }); await tick(); await engine.leaveRoom(); await join()
  leaving.controller.enqueue({ content: bytes }); leaving.controller.close(); await tick(); assert.equal(messages.length, receivedBeforeDisconnect)
  console.log('PASS Reconnection and room changes invalidate an image already in flight')

  failWrite = true; await assert.rejects(engine.sendChatMessage('', undefined, [file]), /Transfer failed/); failWrite = false
  assert.equal(current.sent.at(-1).closed, true)
  interruptSend = true; await assert.rejects(engine.sendChatMessage('', undefined, [file]), /left the room/)
  current.changeState(sdk.ConnectionState.Connected)
  await assert.rejects(engine.sendChatMessage('', 'gone', [file]), /left the room/)
  await assert.rejects(engine.sendChatMessage('', undefined, [new File(['fake'], 'fake.png', {type:'image/png'})]), /valid/)
  await assert.rejects(engine.sendChatMessage('', undefined, [new File(['video'], 'video.mp4', {type:'video/mp4'})]), /Choose/)
  const text = await engine.sendChatMessage('Normal text')
  assert.equal(text.text, 'Normal text'); assert.equal(current.data.length, 1)
  await engine.leaveRoom()
  console.log('PASS Send failure, interrupted send and departed recipients reject cleanly; existing text transport still works')
})().catch(error => { console.error(error); process.exitCode = 1 })

