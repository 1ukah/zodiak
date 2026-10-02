const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { build } = require('esbuild')
const semver = require('semver')
const root = path.resolve(__dirname, '..')
const tick = () => new Promise(resolve => setImmediate(resolve))
const betaRelease = { tag_name: 'v1.2.0-beta', draft: false, prerelease: true, assets: [{ name: 'beta.yml' }] }

async function main() {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'zodiak-updater-'))
  try {
    const bundles = await Promise.all(['updater', 'config'].map(async name => {
      const result = await build({ entryPoints: [path.join(root, `src/main/${name}.ts`)], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['electron', 'electron-updater'] })
      return result.outputFiles[0].text
    }))
    function harness({ packaged = true, prerelease = [], releases = [betaRelease], responseStatus = 200 } = {}) {
      const updater = new EventEmitter()
      const checks = [], requests = [], messages = []
      let downloads = 0, installed = false
      let installArguments
      let check = async () => updater.emit('update-not-available')
      let message = async () => ({ response: 1 })
      let download = async () => { updater.emit('update-downloaded', { version: '1.2.0-beta' }) }
      Object.assign(updater, {
        currentVersion: { prerelease },
        setFeedURL(feed) { this.feed = feed },
        async checkForUpdates() { checks.push({ channel: this.channel, feed: this.feed, allowPrerelease: this.allowPrerelease, allowDowngrade: this.allowDowngrade }); return check() },
        async downloadUpdate() { downloads++; return download() },
        quitAndInstall(...args) { installed = true; installArguments = args },
      })
      const electron = {
        app: { isPackaged: packaged, getPath: () => profile, getVersion: () => '1.1.0' },
        dialog: { showMessageBox: async options => { messages.push(options); return message(options) } },
        net: { fetch: async (url, options) => {
          requests.push({ url, options })
          return { ok: responseStatus === 200, status: responseStatus, json: async () => typeof releases === 'function' ? releases(url) : releases }
        } },
      }
      function load(bundle) {
        const module = { exports: {} }
        new Function('require', 'module', 'exports', bundle)(id => id === 'electron' ? electron : id === 'electron-updater' ? { autoUpdater: updater } : require(id), module, module.exports)
        return module.exports
      }
      const api = load(bundles[0]), config = load(bundles[1])
      api.initializeUpdater(() => null)
      return { api, config, updater, checks, requests, messages, setCheck: fn => { check = fn }, setMessage: fn => { message = fn }, setDownload: fn => { download = fn }, get downloads() { return downloads }, get installed() { return installed }, get installArguments() { return installArguments } }
    }
    const validConfig = { url: 'ws://localhost:7880', apiKey: 'test', apiSecret: 'test' }
    let h = harness()
    assert.equal((await h.config.loadConfig()).updateChannel, 'stable')
    assert.equal(h.config.validateConfig(validConfig).updateChannel, 'stable')
    assert.throws(() => h.config.validateConfig({ ...validConfig, updateChannel: 'alpha' }), /Stable or Beta/)
    await fs.writeFile(path.join(profile, 'config.json'), JSON.stringify({ ...validConfig, updateChannel: 'invalid' }))
    assert.equal((await h.config.loadConfig()).updateChannel, 'stable')
    await h.config.saveConfig({ ...validConfig, updateChannel: 'beta' })
    assert.equal((await h.config.loadConfig()).updateChannel, 'beta')
    await h.api.checkForUpdatesOnStartup()
    assert.equal(h.checks[0].channel, 'beta')
    assert.equal(h.messages.length, 0)
    assert.equal(h.updater.autoDownload, false)
    assert.equal(h.updater.autoInstallOnAppQuit, false)
    assert.equal(h.updater.disableDifferentialDownload, true)
    console.log('PASS Config migration, validation, persistence and startup channel')

    h = harness({ releases: [{ tag_name: 'v2.0.0', prerelease: false }, { ...betaRelease, draft: true }, { ...betaRelease, tag_name: 'v3.0.0-alpha.1' }, betaRelease] })
    await h.api.requestUpdateCheck(true, 'beta')
    assert.match(h.checks[0].feed.url, /\/v1\.2\.0-beta\/$/)
    assert.equal(h.checks[0].feed.channel, 'beta')
    assert.equal(h.checks[0].allowPrerelease, true)
    assert.equal(h.checks[0].allowDowngrade, false)
    assert.equal(h.messages.length, 1)
    await h.api.requestUpdateCheck(true, 'stable')
    assert.equal(h.checks[1].feed.provider, 'github')
    assert.equal(h.checks[1].channel, 'latest')
    assert.equal(h.checks[1].allowPrerelease, false)
    assert.equal(h.checks[1].allowDowngrade, false)
    assert.equal((await h.config.loadConfig()).updateChannel, 'beta')
    console.log('PASS Manual checks use unsaved selection; Beta excludes Stable, Alpha and drafts')

    h = harness({ releases: [{ ...betaRelease, tag_name: 'v1.2.1-beta' }, betaRelease] })
    await h.api.requestUpdateCheck(false, 'beta')
    assert.match(h.checks[0].feed.url, /\/v1\.2\.1-beta\/$/)
    assert.ok(semver.gt('1.2.1-beta', '1.2.0-beta'))
    assert.ok(semver.gt('1.2.1', '1.2.1-beta'))
    h = harness({ releases: [{ ...betaRelease, tag_name: 'v1.2.0-beta.1' }] })
    await h.api.requestUpdateCheck(false, 'beta')
    assert.match(h.checks[0].feed.url, /\/v1\.2\.0-beta\.1\/$/)
    console.log('PASS Simple Beta tags, patch increments, Stable promotion and existing numbered Beta tags')

    h = harness({ releases: url => url.endsWith('page=1') ? Array(100).fill({ tag_name: 'v2.0.0', prerelease: false }) : [betaRelease] })
    await h.api.requestUpdateCheck(false, 'beta')
    assert.equal(h.requests.length, 2)
    assert.match(h.checks[0].feed.url, /\/v1\.2\.0-beta\/$/)
    for (const options of [{ releases: [] }, { releases: [{ ...betaRelease, assets: [] }] }, { responseStatus: 403 }]) {
      h = harness(options)
      await h.api.requestUpdateCheck(true, 'beta')
      assert.equal(h.checks.length, 0)
      assert.equal(h.messages[0].title, 'Update check failed')
      assert.match(h.messages[0].detail, /No Beta release|missing its update manifest|HTTP 403/)
      await h.api.requestUpdateCheck(true, 'stable')
      assert.equal(h.checks.length, 1)
    }
    console.log('PASS Pagination, unpublished Beta, missing manifest and API errors do not fall back to Stable')

    h = harness({ prerelease: ['beta'] })
    await h.api.requestUpdateCheck(false, 'stable')
    assert.equal(h.checks[0].allowDowngrade, true)
    await h.api.requestUpdateCheck(false, 'beta')
    assert.equal(h.checks[1].allowDowngrade, false)
    h = harness({ prerelease: ['alpha', 1] })
    await h.api.requestUpdateCheck(false, 'stable')
    assert.equal(h.checks[0].allowDowngrade, false)
    console.log('PASS Downgrades allowed only when returning from a Beta build to Stable')

    h = harness()
    let finishPrompt
    h.setCheck(async () => h.updater.emit('update-available', { version: '1.2.0-beta' }))
    h.setMessage(() => new Promise(resolve => { finishPrompt = resolve }))
    await h.api.requestUpdateCheck(true, 'beta')
    assert.equal(h.downloads, 0)
    await assert.rejects(h.api.requestUpdateCheck(true, 'stable'), /already being checked/)
    assert.equal(h.checks.length, 1)
    finishPrompt({ response: 1 }); await tick()
    h.setCheck(async () => h.updater.emit('update-not-available'))
    h.setMessage(async () => ({ response: 1 }))
    await h.api.requestUpdateCheck(false, 'stable')
    assert.equal(h.messages.length, 1)
    assert.equal(h.downloads, 0)
    console.log('PASS Pending prompt locks its channel; declining downloads clears the lock and manual state')

    h = harness()
    h.setCheck(async () => h.updater.emit('update-available', { version: '1.2.0-beta' }))
    h.setMessage(async options => ({ response: options.title === 'Update available' ? 0 : 1 }))
    await h.api.requestUpdateCheck(true, 'beta'); await tick()
    assert.equal(h.downloads, 1)
    assert.equal(h.installed, false)
    await assert.rejects(h.api.requestUpdateCheck(true, 'stable'), /waiting to install/)
    console.log('PASS Download needs consent; downloaded update stays tied to its channel and awaits restart consent')

    h = harness()
    h.setCheck(async () => h.updater.emit('update-available', { version: '1.2.0-beta' }))
    h.setMessage(async () => ({ response: 0 }))
    await h.api.requestUpdateCheck(true, 'beta'); await tick()
    assert.equal(h.installed, true)
    assert.deepEqual(h.installArguments, [true, true])
    console.log('PASS Restart and install explicitly requests silent installation and app relaunch')

    h = harness()
    await h.config.saveConfig({ ...validConfig, updateChannel: 'beta', checkForUpdatesOnStartup: false })
    await h.api.checkForUpdatesOnStartup()
    assert.equal(h.checks.length, 0)
    h = harness({ packaged: false })
    await h.api.checkForUpdatesOnStartup()
    await assert.rejects(h.api.requestUpdateCheck(true, 'beta'), /installed zodiak build/)
    assert.equal(h.requests.length, 0)
    console.log('PASS Disabled startup checks and development builds skip network requests')
  } finally {
    assert.equal(path.dirname(profile), path.resolve(os.tmpdir()))
    assert.ok(path.basename(profile).startsWith('zodiak-updater-'))
    await fs.rm(profile, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
