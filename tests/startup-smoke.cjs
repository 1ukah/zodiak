// Exercises the real production main process, preload and renderer without contacting the configured server.
const { app } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { pathToFileURL } = require('node:url')
const root = path.resolve(__dirname, '..')
const profile = require('node:fs').mkdtempSync(path.join(os.tmpdir(), 'zodiak-startup-'))
app.setPath('userData', profile)
app.setPath('sessionData', path.join(profile, 'session'))
const output = path.join(root, 'release/ui-review')
let splashSeen = false
let splashWindow
const failure = setTimeout(() => { console.error('Startup did not finish in 15 seconds'); app.exit(1) }, 15000)
async function start() {
  await fs.mkdir(output, { recursive: true })
  await fs.writeFile(path.join(profile, 'config.json'), JSON.stringify({ url: 'ws://127.0.0.1:1', apiKey: 'test', apiSecret: 'test', displayName: 'Startup check' }))
  app.on('browser-window-created', (_event, win) => {
    if (win.getBounds().width === 360) {
      splashWindow = win
      win.once('show', async () => {
        splashSeen = true
        try { await fs.writeFile(path.join(output, '07-startup.png'), (await win.webContents.capturePage()).toPNG()) } catch {}
      })
    } else {
      win.once('show', async () => {
        try {
          if (!splashSeen) throw Error('The loading window was not shown first')
          await new Promise(resolve => setTimeout(resolve, 250))
          const loaded = await win.webContents.executeJavaScript(`Boolean(window.sharescreen && document.querySelector('#profile-name').textContent === 'Startup check' && document.querySelector('.workspace-rail .icon'))`)
          if (!loaded) throw Error('Main window appeared before the interface initialized')
          const engineLoaded = await win.webContents.executeJavaScript(`performance.getEntriesByType('resource').some(entry => new URL(entry.name).pathname.split('/').at(-1).startsWith('session-'))`)
          if (engineLoaded) throw Error('WebRTC engine was loaded before joining a room')
          if (splashWindow && !splashWindow.isDestroyed()) throw Error('Splash remained after startup')
          await fs.writeFile(path.join(output, '08-production.png'), (await win.webContents.capturePage()).toPNG())
          console.log('PASS Production splash shown before main window')
          console.log('PASS Real preload / renderer readiness handshake')
          console.log('PASS Lobby starts without loading the WebRTC engine')
          console.log('PASS Splash closed after interface initialization')
          async function waitForVisibility(hidden) {
            for (let attempt = 0; attempt < 30; attempt++) {
              if (await win.webContents.executeJavaScript(`document.body.classList.contains('window-hidden') === ${hidden}`)) return
              await new Promise(resolve => setTimeout(resolve, 100))
            }
            throw Error('Native window visibility did not reach the renderer')
          }
          win.minimize(); await waitForVisibility(true)
          win.restore(); await waitForVisibility(false)
          console.log('PASS Native minimize and restore explicitly suspend and resume video UI')
          clearTimeout(failure); win.close(); app.exit(0)
        } catch (error) { console.error(error); app.exit(1) }
      })
    }
  })
  await import(pathToFileURL(path.join(root, 'out/main/index.js')).href)
}
start().catch(error => { console.error(error); app.exit(1) })
