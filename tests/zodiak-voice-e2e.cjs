// Voice and screen share end to end: two real app processes, zodiak-api and zodiak-media.
// The host joins voice, unmutes a fake microphone and shares a screen. The guest joins,
// checks with WebRTC statistics that voice arrives, watches the screen and checks decoded video.
// Usage: start zodiak-api and zodiak-media (zodiak-api/scripts/dev-servers.ps1), then
//   npm run build && electron tests/zodiak-voice-e2e.cjs
const { app } = require('./silent-electron.cjs')
const { spawn } = require('node:child_process')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { pathToFileURL } = require('node:url')

const root = path.resolve(__dirname, '..')
const api = process.env.ZODIAK_API_URL || 'http://127.0.0.1:18080'
process.env.ZODIAK_API_URL = api
const guestIndex = process.argv.indexOf('--guest')
const role = guestIndex > 0 ? 'guest' : 'host'
const shared = role === 'guest' ? process.argv[guestIndex + 1] : require('node:fs').mkdtempSync(path.join(os.tmpdir(), 'zodiak-voice-'))
const profile = require('node:fs').mkdtempSync(path.join(os.tmpdir(), `zodiak-${role}-`))
app.setPath('userData', profile)
app.setPath('sessionData', path.join(profile, 'session'))
app.commandLine.appendSwitch('use-fake-device-for-media-stream')
app.commandLine.appendSwitch('use-fake-ui-for-media-stream')
const output = path.join(root, 'release/ui-review')
const failure = setTimeout(() => { console.error(`FAIL ${role} did not finish in 90 seconds`); app.exit(1) }, 90_000)
const log = (message) => console.log(`${role === 'host' ? 'HOST ' : 'GUEST'} ${message}`)

async function http(method, route, token, body) {
  const response = await fetch(`${api}${route}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  if (!response.ok) throw Error(`${method} ${route} answered ${response.status}: ${text}`)
  return text ? JSON.parse(text) : null
}

async function waitFile(file, timeout = 60_000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    try { return JSON.parse(await fs.readFile(file, 'utf8')) } catch { await new Promise((r) => setTimeout(r, 200)) }
  }
  throw Error(`Timed out waiting for ${path.basename(file)}`)
}

function helpers(win) {
  const js = (code) => win.webContents.executeJavaScript(code)
  async function until(description, code, timeout = 15_000) {
    const end = Date.now() + timeout
    while (Date.now() < end) {
      if (await js(code)) return
      await new Promise((resolve) => setTimeout(resolve, 150))
    }
    throw Error(`Timed out: ${description}`)
  }
  const type = (selector, value) => js(`(() => { const input = document.querySelector(${JSON.stringify(selector)}); input.value = ${JSON.stringify(value)}; input.dispatchEvent(new Event('input')) })()`)
  const click = (selector) => js(`document.querySelector(${JSON.stringify(selector)}).click()`)
  // Records every peer connection so the test can read WebRTC statistics.
  const recordPeers = () => js(`(() => {
    if (window.__pcs) return
    window.__pcs = []
    const Original = RTCPeerConnection
    window.RTCPeerConnection = class extends Original { constructor(...args) { super(...args); window.__pcs.push(this) } }
  })()`)
  const inbound = (kind) => js(`Promise.all(window.__pcs.map(pc => pc.getStats())).then(reports => {
    let bytes = 0, frames = 0
    for (const report of reports) for (const stat of report.values()) {
      if (stat.type === 'inbound-rtp' && stat.kind === '${kind}') { bytes += stat.bytesReceived || 0; frames += stat.framesDecoded || 0 }
    }
    return { bytes, frames }
  })`)
  return { js, until, type, click, recordPeers, inbound }
}

async function login(win, username, othersInVoice = 0) {
  const { until, type, js, recordPeers } = helpers(win)
  await until('the login screen', `document.body.classList.contains('signed-out')`)
  await recordPeers()
  await type('#auth-username', username)
  await type('#auth-password', 'correct horse battery')
  await js(`document.querySelector('#auth-form').requestSubmit()`)
  await until('the server', `document.body.classList.contains('has-guild')`)
  await until('the voice channel', `[...document.querySelectorAll('#channel-list .channel')].some(b => b.textContent === 'General')`)
  if (othersInVoice) await until('the people already in voice', `document.querySelectorAll('.voice-members .member').length === ${othersInVoice}`)
  const before = othersInVoice ? await rowLooks(win, '.voice-members .member') : []
  if (othersInVoice) await sidebarShot(win, 'zodiak-06-voice-row-before-join.png')
  const joinVoice = `[...document.querySelectorAll('#channel-list .channel')].find(b => b.textContent === 'General').click()`
  await js(joinVoice)
  try {
    await until('the voice connection', `document.body.classList.contains('in-room') && document.querySelectorAll('#members-list .member').length >= 1`, 25_000)
  } catch (error) {
    const state = await js(`JSON.stringify({ note: document.querySelector('#stage-note').textContent,
      peers: (window.__pcs || []).map(pc => [pc.connectionState, pc.iceConnectionState, pc.signalingState, pc.localDescription?.type, pc.remoteDescription?.type]) })`)
    throw Error(`${error.message}: ${state}`)
  }
  if (!othersInVoice) return
  await until('the voice panel under the channel', `document.querySelectorAll('#channel-list #members-panel .member').length === ${othersInVoice + 1}`)
  await sidebarShot(win, 'zodiak-07-voice-row-after-join.png')
  const after = await rowLooks(win, '#channel-list #members-panel .member')
  for (const row of before) {
    const same = after.find((other) => other.name === row.name)
    if (JSON.stringify(same) !== JSON.stringify(row)) throw Error(`${row.name} looks different after joining:\n  before ${JSON.stringify(row)}\n  after  ${JSON.stringify(same)}`)
  }
  log('PASS people in the voice channel look the same before and after joining')
}

/** Position, size and colors of each person in a sidebar voice list. */
function rowLooks(win, selector) {
  return win.webContents.executeJavaScript(`[...document.querySelectorAll(${JSON.stringify(selector)})].map(row => {
    const avatar = row.querySelector('.avatar'), name = row.querySelector('.member-name')
    const box = (node) => { const r = node.getBoundingClientRect(); return [r.left, r.width, r.height].map(Math.round) }
    return { name: name.textContent, row: box(row), avatar: [...box(avatar), avatar.textContent, getComputedStyle(avatar).backgroundColor],
      text: [Math.round(name.getBoundingClientRect().left), getComputedStyle(name).fontSize] }
  })`)
}

async function sidebarShot(win, name) {
  const image = await win.webContents.capturePage({ x: 68, y: 88, width: 224, height: 240 })
  await fs.writeFile(path.join(output, name), image.toPNG())
}

async function host(win) {
  const { js, until, click } = helpers(win)
  const shot = async (name) => fs.writeFile(path.join(output, name), (await win.webContents.capturePage()).toPNG())
  const suffix = Math.random().toString(36).slice(2, 8)
  const owner = await http('POST', '/v1/auth/register', null, { username: `host_${suffix}`, password: 'correct horse battery', display_name: 'Host' })
  const guest = await http('POST', '/v1/auth/register', null, { username: `guest_${suffix}`, password: 'correct horse battery', display_name: 'Guest' })
  const guild = await http('POST', '/v1/guilds', owner.token, { name: 'Voice test' })
  const invite = await http('POST', `/v1/guilds/${guild.guild.id}/invites`, owner.token, {})
  await http('POST', `/v1/invites/${invite.code}`, guest.token)
  await fs.writeFile(path.join(shared, 'setup.json'), JSON.stringify({ guest: `guest_${suffix}` }))

  await login(win, `host_${suffix}`)
  log('PASS joined voice')
  await click('#voice-mute')
  await until('the microphone to send', `document.querySelector('#voice-mute').getAttribute('aria-pressed') === 'false'`, 15_000)
  log('PASS unmuted the fake microphone')

  const child = spawn(process.execPath, [__filename, '--guest', shared], { stdio: 'inherit', env: process.env })
  const guestDone = new Promise((resolve) => child.on('exit', resolve))

  await waitFile(path.join(shared, 'guest-joined.json'))
  await click('#share')
  await until('screen sources', `document.querySelectorAll('#sources .source').length > 0`, 15_000)
  await js(`document.querySelector('#system-audio').checked = false; document.querySelector('#system-audio').dispatchEvent(new Event('change'))`)
  await click('#sources .source')
  await js(`document.querySelector('#picker-form').requestSubmit()`)
  await until('the screen share', `!document.querySelector('#stop-live').hidden`, 20_000)
  log('PASS started an H.264 screen share')
  const codec = await js(`Promise.all(window.__pcs.map(pc => pc.getStats())).then(reports => {
    for (const report of reports) for (const stat of report.values()) if (stat.type === 'outbound-rtp' && stat.kind === 'video') return report.get(stat.codecId)?.mimeType
  })`)
  if (codec && codec.toLowerCase() !== 'video/h264') throw Error(`The screen uses ${codec}, not H.264`)

  await waitFile(path.join(shared, 'guest-watching.json'), 60_000)
  await http('PATCH', '/v1/users/@me', owner.token, { display_name: 'Host Renamed' })
  await waitFile(path.join(shared, 'guest-saw-rename.json'), 20_000)
  await http('DELETE', `/v1/guilds/${guild.guild.id}/members/${guest.user.id}`, owner.token)
  log('PASS renamed, then removed the guest from the server')

  const result = await waitFile(path.join(shared, 'guest-result.json'), 60_000)
  await shot('zodiak-04-voice-host.png')
  const code = await guestDone
  if (code !== 0 || !result.ok) throw Error(`The guest failed: ${result.error ?? code}`)
  await click('#leave')
  await until('leaving voice', `!document.body.classList.contains('in-room')`)
  log('PASS left voice')
}

async function guest(win) {
  const { until, inbound, js } = helpers(win)
  const shot = async (name) => fs.writeFile(path.join(output, name), (await win.webContents.capturePage()).toPNG())
  const setup = await waitFile(path.join(shared, 'setup.json'))
  try {
    await login(win, setup.guest, 1)
    await until('both people in voice', `document.querySelectorAll('#members-list .member').length === 2`, 15_000)
    await until('the voice stage', `!document.body.classList.contains('view-text') && getComputedStyle(document.querySelector('#stage-wrap')).display !== 'none'`, 5_000)
    log('PASS joined voice and sees the host on the voice stage')
    await fs.writeFile(path.join(shared, 'guest-joined.json'), '{}')

    const start = (await inbound('audio')).bytes
    await new Promise((resolve) => setTimeout(resolve, 2_000))
    const audio = (await inbound('audio')).bytes
    if (audio - start < 2_000) throw Error(`Too little voice audio arrived: ${audio - start} bytes in 2 s`)
    log(`PASS receives the host's voice (${audio - start} bytes in 2 s)`)

    await until('the host screen', `Boolean(document.querySelector('.start-watching'))`, 30_000)
    await js(`document.querySelector('.start-watching').click()`)
    await until('decoded screen video', `Promise.all(window.__pcs.map(pc => pc.getStats())).then(rs => rs.some(r => [...r.values()].some(s => s.type === 'inbound-rtp' && s.kind === 'video' && s.framesDecoded > 10)))`, 25_000)
    const video = await inbound('video')
    log(`PASS watches the host's screen (${video.frames} frames decoded)`)
    await until('the voice panel under the channel', `document.querySelectorAll('#channel-list #members-panel .member').length === 2 && Boolean(document.querySelector('#channel-list #members-panel .member-live')) && !document.querySelector('.voice-members')`, 10_000)
    log('PASS the connected channel shows one list with both people and the LIVE screen')
    await new Promise((resolve) => setTimeout(resolve, 800))
    await shot('zodiak-05-voice-guest.png')
    await fs.writeFile(path.join(shared, 'guest-watching.json'), '{}')

    await until('the new name in voice', `[...document.querySelectorAll('#members-list .member-name')].some(n => n.textContent === 'Host Renamed')
      && [...document.querySelectorAll('#member-list .member-row:not(.is-offline) .member-row-name')].some(n => n.textContent === 'Host Renamed')`, 5_000)
    log('PASS sees the host\'s new name in voice at once')
    await fs.writeFile(path.join(shared, 'guest-saw-rename.json'), '{}')

    await until('removal from voice', `!document.body.classList.contains('in-room')`, 5_000)
    const note = await js(`document.querySelector('#stage-note').textContent`)
    if (!note.includes('removed')) throw Error(`Unexpected message after removal: ${note}`)
    log(`PASS was disconnected from voice at once ("${note}")`)
    await fs.writeFile(path.join(shared, 'guest-result.json'), JSON.stringify({ ok: true }))
  } catch (error) {
    await shot('zodiak-05-voice-guest-failure.png').catch(() => undefined)
    await fs.writeFile(path.join(shared, 'guest-result.json'), JSON.stringify({ ok: false, error: String(error) }))
    throw error
  }
}

async function start() {
  await fs.mkdir(output, { recursive: true })
  app.on('browser-window-created', (_event, win) => {
    if (win.getBounds().width === 360) return
    win.once('show', () => (role === 'host' ? host(win) : guest(win)).then(
      () => { clearTimeout(failure); app.exit(0) },
      (error) => { console.error(`FAIL ${role}`, error); app.exit(1) },
    ))
  })
  await import(pathToFileURL(path.join(root, 'out/main/index.js')).href)
}
start().catch((error) => { console.error(error); app.exit(1) })
