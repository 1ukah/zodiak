const { buildSync } = require('esbuild')
const assert = require('node:assert/strict')
const Module = require('node:module')
const path = require('node:path')
const code = buildSync({ entryPoints:[path.join(__dirname,'../src/shared/chat.ts')], bundle:true, platform:'node', format:'cjs', write:false }).outputFiles[0].text
const compiled = new Module('chat-protocol'); compiled._compile(code, 'chat-protocol.cjs')
const { parseChatPacket, CHAT_MAX_LENGTH, CHAT_MAX_BYTES } = compiled.exports
const encode = value => new TextEncoder().encode(JSON.stringify(value))
const message = { version:1, id:'message-1', timestamp:Date.now(), text:'Olá 😀', recipient:'bob' }
assert.deepEqual(parseChatPacket(encode(message)),message)
for (const value of [null, 'text', {}, {...message,version:2}, {...message,id:'<script>'}, {...message,text:''}, {...message,text:'   '}, {...message,text:'x'.repeat(CHAT_MAX_LENGTH+1)}, {...message,timestamp:Infinity}, {...message,timestamp:-1}, {...message,timestamp:1.5}, {...message,recipient:''}, {...message,recipient:[]}, {...message,recipient:'x'.repeat(257)}]) assert.equal(parseChatPacket(encode(value)),null)
assert.equal(parseChatPacket(new Uint8Array(CHAT_MAX_BYTES+1)),null)
assert.equal(parseChatPacket(new Uint8Array([255,254])),null)
assert.equal(parseChatPacket(new TextEncoder().encode('{broken')),null)
assert.equal(parseChatPacket(encode({...message,text:'😀'.repeat(1000)})).text.length,2000)
assert.deepEqual(parseChatPacket(encode({...message,senderId:'spoof',senderName:'spoof',local:true})),message)
console.log('PASS Packet validation rejects malformed, oversize, and invalid UTF-8 messages; ignores forged sender fields')
