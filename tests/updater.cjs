const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { build } = require('esbuild')
const updaterSemver = require('node:module').createRequire(require.resolve('electron-updater'))('semver')
const { AppUpdater } = require('electron-updater/out/AppUpdater')
const { GenericProvider } = require('electron-updater/out/providers/GenericProvider')
const root = path.resolve(__dirname, '..')
const betaRelease = { tag_name: 'v1.2.0-beta', draft: false, prerelease: true, assets: [{ name: 'beta.yml' }] }

async function main() {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'zodiak-updater-'))
  try {
    const bundles = await Promise.all(['updater', 'config'].map(async name => {
      const result = await build({ entryPoints: [path.join(root, `src/main/${name}.ts`)], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['electron', 'electron-updater'] })
      return result.outputFiles[0].text
    }))
    function harness({ packaged = true, version = '1.1.0', releases = [betaRelease], responseStatus = 200, platform = 'win32' } = {}) {
      const updater = new EventEmitter()
      const checks = [], requests = [], states = [], progress = []
      let downloads = 0, installed = 0, installArguments
      let check = async () => updater.emit('update-not-available')
      let download = async () => updater.emit('update-downloaded', { version: '1.2.0-beta' })
      Object.assign(updater, {
        currentVersion: updaterSemver.parse(version), _logger: { info() {} },
        isUpdateSupported: () => true, isUserWithinRollout: () => true,
        isUpdateAvailable: AppUpdater.prototype.isUpdateAvailable, onUpdateAvailable: AppUpdater.prototype.onUpdateAvailable,
        setFeedURL(feed) { this.feed = feed },
        async checkForUpdates() { checks.push({ channel: this.channel, feed: this.feed, allowPrerelease: this.allowPrerelease, allowDowngrade: this.allowDowngrade }); return check() },
        async downloadUpdate() { downloads++; return download() },
        quitAndInstall(...args) { installed++; installArguments = args },
      })
      const electron = {
        app: { isPackaged: packaged, getPath: () => profile, getVersion: () => version },
        dialog: { showMessageBox() { throw Error('Updater must never show native dialogs') } },
        net: { fetch: async (url, options) => {
          requests.push({ url, options })
          return { ok: responseStatus === 200, status: responseStatus, json: async () => typeof releases === 'function' ? releases(url) : releases }
        } },
      }
      function load(bundle) {
        const module = { exports: {} }
        new Function('require', 'module', 'exports', 'process', bundle)(id => id === 'electron' ? electron : id === 'electron-updater' ? { autoUpdater: updater } : require(id), module, module.exports, { ...process, platform })
        return module.exports
      }
      const api = load(bundles[0]), config = load(bundles[1])
      api.initializeUpdater(() => ({ isDestroyed: () => false, setProgressBar: value => progress.push(value), webContents: { send: (channel, state) => { assert.equal(channel, 'update:state:changed'); states.push(state) } } }))
      return { api, config, updater, checks, requests, states, progress,
        get state() { return api.getUpdateState() },
        setCheck: fn => { check = fn }, setDownload: fn => { download = fn },
        setCandidate: candidate => {
          updater.getUpdateInfoAndProvider = async () => ({ info: { version: candidate }, provider: updater.feed })
          check = () => AppUpdater.prototype.doCheckForUpdates.call(updater)
        },
        get downloads() { return downloads }, get installed() { return installed }, get installArguments() { return installArguments },
      }
    }
    const validConfig = { url: 'ws://localhost:7880', apiKey: 'test', apiSecret: 'test' }
    let h = harness()
    assert.equal((await h.config.loadConfig()).updateChannel, 'stable')
    assert.equal(h.config.validateConfig(validConfig).updateChannel, 'stable')
    assert.throws(() => h.config.validateConfig({ ...validConfig, updateChannel: 'alpha' }), /Stable or Beta/)
    await fs.writeFile(path.join(profile, 'config.json'), JSON.stringify({ ...validConfig, updateChannel: 'invalid' }))
    assert.equal((await h.config.loadConfig()).updateChannel, 'stable')
    await h.config.saveConfig({ ...validConfig, updateChannel: 'beta' })
    await h.api.checkForUpdatesOnStartup()
    assert.equal(h.checks[0].channel, 'beta')
    assert.equal(h.state.visible, false)
    assert.equal(h.updater.autoDownload, false)
    assert.equal(h.updater.autoInstallOnAppQuit, false)
    assert.equal(h.updater.disableDifferentialDownload, true)
    console.log('PASS Config migration, persistence, startup channel and explicit update consent')

    h = harness({ releases: [{ tag_name: 'v2.0.0', prerelease: false }, { ...betaRelease, draft: true }, { ...betaRelease, tag_name: 'v3.0.0-alpha.1' }, betaRelease] })
    await h.api.requestUpdateCheck(true, 'beta')
    assert.match(h.checks[0].feed.url, /\/v1\.2\.0-beta\/$/)
    assert.equal(h.checks[0].allowPrerelease, true)
    assert.equal(h.checks[0].allowDowngrade, true)
    assert.equal(h.state.phase, 'current')
    assert.equal(h.state.visible, true)
    await h.api.requestUpdateCheck(true, 'stable')
    assert.equal(h.checks[1].feed.provider, 'github')
    assert.equal(h.checks[1].channel, 'latest')
    assert.equal(h.checks[1].allowPrerelease, false)
    assert.equal(h.checks[1].allowDowngrade, false)
    assert.equal((await h.config.loadConfig()).updateChannel, 'beta')
    for (const tag of ['v1.2.1-beta', 'v1.2.0-beta.1']) {
      h = harness({ releases: [{ ...betaRelease, tag_name: tag }, betaRelease] })
      await h.api.requestUpdateCheck(false, 'beta')
      assert.ok(h.checks[0].feed.url.endsWith(`/${tag}/`))
    }
    h = harness({ releases: url => url.endsWith('page=1') ? Array(100).fill({ tag_name: 'v2.0.0', prerelease: false }) : [betaRelease] })
    await h.api.requestUpdateCheck(false, 'beta')
    assert.equal(h.requests.length, 2)
    for (const options of [{ releases: [] }, { releases: [{ ...betaRelease, assets: [] }] }, { responseStatus: 403 }]) {
      h = harness(options)
      await h.api.requestUpdateCheck(true, 'beta')
      assert.equal(h.checks.length, 0)
      assert.equal(h.state.phase, 'error')
      assert.equal(h.state.retry, 'check')
      await h.api.requestUpdateCheck(true, 'stable')
      assert.equal(h.checks.length, 1)
    }
    console.log('PASS Stable/Beta feeds, tag formats, pagination and custom check errors')

    for (const [version, channel, candidate, available] of [
      ['1.2.1', 'beta', '1.2.1-beta', true], ['1.2.1', 'beta', '1.2.0-beta', true],
      ['1.2.1-beta', 'stable', '1.2.1', true], ['1.2.1-beta', 'stable', '1.2.0', true],
      ['1.2.1', 'stable', '1.2.1', false], ['1.2.1-beta', 'beta', '1.2.1-beta', false],
      ['1.2.1', 'stable', '1.2.0', false], ['1.2.1-beta', 'beta', '1.2.0-beta', false],
      ['1.2.1-beta', 'beta', '1.2.2-beta', true],
    ]) {
      h = harness({ version })
      h.setCandidate(candidate)
      await h.api.requestUpdateCheck(true, channel)
      assert.equal(h.state.phase, available ? 'available' : 'current', `${version} -> ${candidate}`)
      assert.equal(h.downloads, 0)
      await h.api.performUpdateAction('dismiss')
      await h.api.requestUpdateCheck(true, channel)
      assert.equal(h.state.phase, available ? 'available' : 'current')
    }
    console.log('PASS Actual updater semver/events and declined-update retries across channels')

    h = harness({ version: '1.2.1' })
    h.setCandidate('1.2.1-beta')
    await h.api.requestUpdateCheck(true, 'beta')
    await assert.rejects(h.api.requestUpdateCheck(true, 'stable'), /already being checked/)
    assert.equal(h.downloads, 0)
    await h.api.performUpdateAction('download')
    assert.equal(h.downloads, 1)
    assert.equal(h.state.phase, 'downloaded')
    assert.equal(h.installed, 0)
    assert.equal(h.updater.updateInfoAndProvider.provider.channel, 'beta')
    const provider = new GenericProvider(h.updater.feed, h.updater, { platform: 'win32', executor: null })
    let manifestUrl
    provider.httpRequest = async url => { manifestUrl = url; return 'version: 1.2.1-beta\nfiles: []\n' }
    assert.equal((await provider.getLatestVersion()).version, '1.2.1-beta')
    assert.equal(manifestUrl.pathname.split('/').pop(), 'beta.yml')
    await h.api.performUpdateAction('dismiss')
    assert.equal(h.state.visible, false)
    await h.api.requestUpdateCheck(true, 'beta')
    assert.equal(h.state.visible, true)
    assert.equal(h.state.phase, 'downloaded')
    assert.equal(h.downloads, 1)
    await assert.rejects(h.api.requestUpdateCheck(true, 'stable'), /waiting to install/)
    await h.api.performUpdateAction('install')
    assert.equal(h.installed, 1)
    assert.deepEqual(h.installArguments, [true, true])
    await assert.rejects(h.api.performUpdateAction('install'), /no longer available/)
    console.log('PASS Download/install need explicit actions; Later reopens cached update without redownload')

    h = harness()
    h.setCandidate('1.2.0-beta')
    await h.api.requestUpdateCheck(true, 'beta')
    let finishDownload
    h.setDownload(() => new Promise(resolve => { finishDownload = resolve }))
    const downloading = h.api.performUpdateAction('download')
    assert.equal(h.state.phase, 'downloading')
    await assert.rejects(h.api.performUpdateAction('download'), /no longer available/)
    await h.api.performUpdateAction('dismiss')
    assert.equal(h.state.visible, true)
    h.updater.emit('download-progress', { percent: 63, transferred: 126_000_000, total: 200_000_000, bytesPerSecond: 8_000_000 })
    assert.equal(h.state.progress.percent, 63)
    assert.equal(h.progress.at(-1), .63)
    h.updater.emit('download-progress', { percent: 100, transferred: 200_000_000, total: 200_000_000, bytesPerSecond: 8_000_000 })
    assert.equal(h.state.phase, 'downloading', '100% is not ready until validation finishes')
    h.updater.emit('update-downloaded', { version: '1.2.0-beta' })
    finishDownload(); await downloading
    assert.equal(h.state.phase, 'downloaded')
    assert.equal(h.progress.at(-1), -1)
    assert.ok(h.states.every((state, index) => index === 0 || state.revision > h.states[index - 1].revision))
    console.log('PASS Real download telemetry, taskbar, monotonic recovery state and duplicate-action protection')

    h = harness()
    h.setCandidate('1.2.0-beta')
    await h.api.requestUpdateCheck(true, 'beta')
    h.setDownload(async () => { throw Error('offline') })
    await h.api.performUpdateAction('download')
    assert.equal(h.state.phase, 'error')
    assert.equal(h.state.retry, 'download')
    h.setDownload(async () => h.updater.emit('update-downloaded', { version: '1.2.0-beta' }))
    await h.api.performUpdateAction('retry')
    assert.equal(h.state.phase, 'downloaded')
    h.updater.quitAndInstall = () => h.updater.emit('error', Error('Cannot start installer'))
    await h.api.performUpdateAction('install')
    assert.equal(h.state.retry, 'install')
    await h.api.performUpdateAction('dismiss')
    assert.equal(h.state.visible, false)
    await h.api.requestUpdateCheck(true, 'beta')
    assert.equal(h.state.visible, true)
    h.updater.quitAndInstall = () => { throw Error('Start failed') }
    await h.api.performUpdateAction('retry')
    assert.equal(h.state.phase, 'error')
    assert.equal(h.state.retry, 'install')
    await assert.rejects(h.api.performUpdateAction('arbitrary'), /Invalid update action/)
    console.log('PASS Custom retry states for network/install-launch failures and input validation')

    h = harness()
    await h.config.saveConfig({ ...validConfig, updateChannel: 'beta', checkForUpdatesOnStartup: false })
    await h.api.checkForUpdatesOnStartup()
    assert.equal(h.checks.length, 0)
    h = harness({ packaged: false })
    await h.api.checkForUpdatesOnStartup()
    await assert.rejects(h.api.requestUpdateCheck(true, 'beta'), /installed zodiak build/)
    await assert.rejects(h.api.performUpdateAction('download'), /installed zodiak build/)
    assert.equal(h.requests.length, 0)
    console.log('PASS Disabled startup checks and development builds skip network/install actions')
    h = harness({ platform: 'linux' })
    await h.api.checkForUpdatesOnStartup()
    await assert.rejects(h.api.requestUpdateCheck(true), /Install a new package/)
    await assert.rejects(h.api.performUpdateAction('install'), /Install a new package/)
    assert.equal(h.requests.length, 0)
    assert.equal(h.checks.length, 0)
    assert.equal(h.downloads, 0)
    assert.equal(h.installed, 0)
    assert.equal(h.state.phase, 'idle')
    console.log('PASS Linux skips update feeds, downloads and installers')
  } finally {
    assert.equal(path.dirname(profile), path.resolve(os.tmpdir()))
    assert.ok(path.basename(profile).startsWith('zodiak-updater-'))
    await fs.rm(profile, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
