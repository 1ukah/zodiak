// End-to-end check against a running zodiak-api (default http://127.0.0.1:18080):
// register, create a server, send a message, receive a live message from a second user, log out.
// Usage: npm run build && electron tests/zodiak-e2e.cjs
const { app } = require('./silent-electron.cjs')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { pathToFileURL } = require('node:url')

const root = path.resolve(__dirname, '..')
const api = process.env.ZODIAK_API_URL || 'http://127.0.0.1:18080'
process.env.ZODIAK_API_URL = api
const profile = require('node:fs').mkdtempSync(path.join(os.tmpdir(), 'zodiak-e2e-'))
app.setPath('userData', profile)
app.setPath('sessionData', path.join(profile, 'session'))
const output = path.join(root, 'release/ui-review')
const suffix = Math.random().toString(36).slice(2, 8)
const failure = setTimeout(() => { console.error('FAIL The test did not finish in 60 seconds'); app.exit(1) }, 60_000)

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

async function run(win) {
  const js = (code) => win.webContents.executeJavaScript(code)
  const shot = async (name) => fs.writeFile(path.join(output, name), (await win.webContents.capturePage()).toPNG())
  async function until(description, code, timeout = 8000) {
    const end = Date.now() + timeout
    while (Date.now() < end) {
      if (await js(code)) return
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw Error(`Timed out: ${description}`)
  }
  const type = (selector, value) => js(`(() => { const input = document.querySelector(${JSON.stringify(selector)}); input.value = ${JSON.stringify(value)}; input.dispatchEvent(new Event('input')) })()`)
  const click = (selector) => js(`document.querySelector(${JSON.stringify(selector)}).click()`)

  await until('the login screen', `!document.querySelector('#auth-screen').hidden && document.body.classList.contains('signed-out')`)
  await shot('zodiak-01-login.png')
  console.log('PASS Signed-out users see the login screen')

  const username = `e2e_${suffix}`
  await click('#auth-tab-register')
  await type('#auth-username', username)
  await type('#auth-display-name', 'E2E Tester')
  await type('#auth-password', 'correct horse battery')
  await js(`document.querySelector('#auth-form').requestSubmit()`)
  await until('the empty app after registration', `!document.body.classList.contains('signed-out') && document.querySelector('#waiting-message').textContent.includes('Create a server')`)
  const tokenOnDisk = await fs.readFile(path.join(profile, 'zodiak-session.bin'))
  if (/[0-9a-f]{64}/.test(tokenOnDisk.toString('latin1'))) throw Error('The session token was stored as plain text')
  if (await js(`'token' in window.zodiak || JSON.stringify(Object.keys(window.zodiak)).includes('token')`)) throw Error('The renderer can see the token')
  console.log('PASS Registration works, and the token is encrypted on disk and hidden from the renderer')

  await click('#create-room-action')
  await type('#guild-create-name', 'E2E Server')
  await js(`document.querySelector('#guild-create-form').requestSubmit()`)
  await until('the new server with its text channel', `document.body.classList.contains('view-text') && document.querySelector('#text-title').textContent === 'general' && document.querySelectorAll('#room-list .room').length === 1`)
  console.log('PASS Creating a server opens its text channel')

  await type('#text-input', 'Hello from the app <b>not bold</b>')
  await js(`document.querySelector('#text-form').requestSubmit()`)
  await until('the sent message', `[...document.querySelectorAll('#text-messages .chat-message-text')].some(m => m.textContent.includes('<b>not bold</b>'))`)
  if (await js(`Boolean(document.querySelector('#text-messages b'))`)) throw Error('Message text was rendered as HTML')
  console.log('PASS Sending a message works, and message text is never HTML')

  const guildId = await js(`window.zodiak.request({ method: 'GET', path: '/v1/guilds' }).then(r => r.value[0].id)`)
  const invite = await js(`window.zodiak.request({ method: 'POST', path: '/v1/guilds/${guildId}/invites', body: {} }).then(r => r.value.code)`)
  const friend = await http('POST', '/v1/auth/register', null, { username: `friend_${suffix}`, password: 'correct horse battery', display_name: 'Friend' })
  await http('POST', `/v1/invites/${invite}`, friend.token)
  const channelId = await js(`window.zodiak.request({ method: 'GET', path: '/v1/guilds/${guildId}' }).then(r => r.value.channels.find(c => c.kind === 'text').id)`)
  await http('POST', `/v1/channels/${channelId}/messages`, friend.token, { content: 'Live from a friend: https://example.com/page' })
  await until('the friend message over the gateway', `[...document.querySelectorAll('#text-messages .chat-message-text')].some(m => m.textContent.includes('Live from a friend'))`)
  const link = await js(`document.querySelector('#text-messages a')?.href`)
  if (link !== 'https://example.com/page') throw Error(`Links were not made safely clickable: ${link}`)
  console.log('PASS Messages from other members arrive live')

  await click('#guild-invite')
  await until('an invite code', `/^[A-Za-z0-9]{10}$/.test(document.querySelector('#invite-code').value)`)
  await shot('zodiak-02-invite.png')
  await js(`document.querySelector('#invite-dialog').close()`)
  const blocked = await js(`window.zodiak.request({ method: 'POST', path: '/v1/auth/logout-all' })`)
  if (blocked.ok) throw Error('The renderer could call a reserved route')
  await shot('zodiak-03-chat.png')
  console.log('PASS The renderer cannot use reserved session routes')

  await js(`document.querySelector('[data-settings]').click()`)
  await click('#logout')
  await until('the login screen after logout', `document.body.classList.contains('signed-out')`)
  if (await fs.stat(path.join(profile, 'zodiak-session.bin')).then(() => true, () => false)) throw Error('Logout left the session file')
  console.log('PASS Logout removes the session')
}

async function start() {
  await fs.mkdir(output, { recursive: true })
  await http('GET', '/v1/users/@me').catch((error) => {
    if (!String(error).includes('401')) { console.error(`FAIL zodiak-api is not running at ${api}`); app.exit(1) }
  })
  app.on('browser-window-created', (_event, win) => {
    if (win.getBounds().width === 360) return
    win.once('show', () => run(win).then(
      () => { clearTimeout(failure); app.exit(0) },
      (error) => { console.error('FAIL', error); app.exit(1) },
    ))
  })
  await import(pathToFileURL(path.join(root, 'out/main/index.js')).href)
}
start().catch((error) => { console.error(error); app.exit(1) })
