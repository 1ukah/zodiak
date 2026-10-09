// Run the distributed application with isolated user folders and its real IPC.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const net = require('node:net')

const executable = path.resolve(process.argv[2] || 'dist/linux-unpacked/zodiak')
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

async function freePort() {
  const server = net.createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}

async function connect(port, exited) {
  const deadline = Date.now() + 30000
  let lastState
  while (Date.now() < deadline) {
    if (exited()) throw Error('Packaged application closed before it was ready')
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      lastState = targets.map(({ type, url }) => ({ type, url: url.slice(0, 180) }))
      const page = targets.find(target => target.type === 'page' && target.url.endsWith('/index.html'))
      if (page) {
        const socket = new WebSocket(page.webSocketDebuggerUrl)
        await once(socket, 'open')
        let id = 0
        const pending = new Map()
        socket.addEventListener('close', () => {
          for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(Error('Application closed its debug connection')) }
          pending.clear()
        })
        socket.addEventListener('message', event => {
          const response = JSON.parse(event.data)
          if (!response.id) return
          const entry = pending.get(response.id)
          if (!entry) return
          pending.delete(response.id)
          clearTimeout(entry.timer)
          if (response.error) entry.reject(Error(response.error.message))
          else entry.resolve(response.result)
        })
        const command = (method, params = {}) => new Promise((resolve, reject) => {
          const key = ++id
          const timer = setTimeout(() => { pending.delete(key); reject(Error(`Timeout: ${method}`)) }, 10000)
          pending.set(key, { resolve, reject, timer })
          socket.send(JSON.stringify({ id: key, method, params }))
        })
        const evaluate = async expression => {
          const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
          if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
          return result.result.value
        }
        return { evaluate, command, close: () => socket.close() }
      }
    } catch (error) {
      lastState = error.message
      if (error.message === 'Packaged application closed before it was ready') throw error
    }
    await wait(100)
  }
  throw Error('Packaged application did not expose its main window in 30 seconds: ' + JSON.stringify(lastState))
}

async function main() {
  assert.equal(process.platform, 'linux')
  await fs.access(executable)
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'zodiak-package-'))
  const configRoot = path.join(temporary, 'config')
  const profile = path.join(configRoot, 'zodiak')
  const participant = '11111111-1111-4111-8111-111111111111'
  let previousIdentity
  try {
    await fs.mkdir(profile, { recursive: true })
    await fs.writeFile(path.join(profile, 'config.json'), JSON.stringify({
      url: 'ws://127.0.0.1:1', apiKey: 'test', apiSecret: 'test', displayName: 'Linux package test',
    }))
    for (let launch = 0; launch < 2; launch++) {
      const port = await freePort()
      const args = [
        '--ozone-platform=wayland', `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1',
      ]
      const env = { ...process.env, XDG_CONFIG_HOME: configRoot, XDG_CACHE_HOME: path.join(temporary, 'cache') }
      delete env.APPIMAGE_EXTRACT_AND_RUN
      const child = spawn(executable, args, {
        detached: true,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let log = ''
      let exit
      const finished = new Promise(resolve => {
        child.once('error', error => { exit = error; resolve() })
        child.once('exit', (code, signal) => { exit = { code, signal }; resolve() })
      })
      for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { log = (log + chunk).slice(-16000) })
      let client
      try {
        client = await connect(port, () => exit !== undefined)
        const expectedName = launch ? 'Linux saved settings' : 'Linux package test'
        let loaded = false
        for (let attempt = 0; attempt < 100; attempt++) {
          loaded = await client.evaluate(`Boolean(window.sharescreen && document.querySelector('#profile-name')?.textContent === ${JSON.stringify(expectedName)})`)
          if (loaded) break
          await wait(100)
        }
        assert.equal(loaded, true, 'Production renderer must load the saved user configuration')
        const capabilities = await client.evaluate('window.sharescreen.getPlatformCapabilities()')
        assert.equal(capabilities.capturePicker, 'portal')
        assert.equal(capabilities.systemAudioCapture, false)
        assert.equal(capabilities.automaticUpdates, false)
        const identity = JSON.parse(await fs.readFile(path.join(profile, 'identity.json'), 'utf8')).uuid
        assert.match(identity, /^[0-9a-f-]{36}$/)
        if (!launch) {
          previousIdentity = identity
          const saved = await client.evaluate(`(async () => {
            const config = await window.sharescreen.getConfig();
            const result = await window.sharescreen.saveConfig({...config, displayName: 'Linux saved settings'});
            const preferences = await window.sharescreen.saveParticipantPreferences({server: config.url, participants: [{id: '${participant}', name: 'Linux friend', volume: .35}]});
            return {result, preferences};
          })()`)
          assert.equal(saved.result.ok, true)
          assert.equal(saved.preferences.ok, true)
          console.log('PASS Packaged app loads its real preload, renderer, and Linux capabilities')
          console.log('PASS Settings, identity, and participant preferences are saved in the writable XDG user folder')
        } else {
          assert.equal(identity, previousIdentity, 'Identity must survive package restart')
          const preferences = await client.evaluate(`window.sharescreen.getParticipantPreferences('ws://127.0.0.1:1')`)
          assert.equal(preferences.ok, true)
          assert.equal(preferences.value[participant].volume, .35)
          const image = await client.command('Page.captureScreenshot', { format: 'png' })
          const output = path.resolve('release/ui-review')
          await fs.mkdir(output, { recursive: true })
          await fs.writeFile(path.join(output, 'linux-package.png'), Buffer.from(image.data, 'base64'))
          console.log('PASS Package restart retains settings, identity, and participant volume')
        }
      } catch (error) {
        console.error(log)
        throw error
      } finally {
        if (client && exit === undefined) {
          const closing = client.evaluate('window.close()').catch(() => undefined)
          await Promise.race([finished, wait(3000)])
          client.close()
          await closing
        }
        client?.close()
        if (exit === undefined && child.pid) {
          try { process.kill(-child.pid, 'SIGTERM') } catch (error) { if (error.code !== 'ESRCH') throw error }
        }
        await Promise.race([finished, wait(5000)])
        if (exit === undefined && child.pid) {
          try { process.kill(-child.pid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error }
          await finished
        }
      }
    }
    console.log(`PASS Linux package: ${path.basename(executable)}`)
  } finally {
    await fs.rm(temporary, { recursive: true, force: true })
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
