const { app, BrowserWindow } = require('./silent-electron.cjs')
const { build } = require('./build-renderer.cjs')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const root = path.resolve(__dirname, '..')
const temp = require('node:fs').mkdtempSync(path.join(os.tmpdir(), 'zodiak-viewers-'))
app.setPath('userData', path.join(temp, 'profile'))
app.setPath('sessionData', path.join(temp, 'session'))
const timeout = setTimeout(() => { console.error('Viewer tests timed out'); app.exit(1) }, 60000)
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

async function main() {
  const source = await fs.readFile(path.join(root, 'src/renderer/src/session.ts'), 'utf8')
  const probe = `
window.viewerProbe = async () => {
  const current = new Room(); room = current; current.state = ConnectionState.Connected;
  current.localParticipant.identity = 'me'; localParticipantName = 'Alex';
  let emitted = [], changes = [], release;
  hooks = { onViewers() {}, onParticipants() {}, onStreams(value) { emitted = value }, onError(message) { throw Error(message) } };
  bindRoom(current);
  current.localParticipant.setAttributes = async value => {
    changes.push(value[WATCHING_ATTRIBUTE]);
    if (release === undefined) await new Promise(resolve => { release = resolve });
  };
  const person = (id, name, value) => ({identity:id, name, trackPublications:new Map(), attributes:{[WATCHING_ATTRIBUTE]:value}});
  const sam = person('sam', 'Sam', '["mine","screen"]');
  const jo = person('jo', 'Jordan', '["mine"]');
  current.remoteParticipants.set('sam', sam); current.remoteParticipants.set('jo', jo);
  let subscription;
  const record = (id, sid, owner, local, subscribed) => ({id,sid,participantId:owner,participantName:owner,local,subscribed,muted:false,viewers:[],
    publication:local ? undefined : {setSubscribed(value) { subscription = value }} });
  streams = new Map([['local',record('local','mine','me',true,true)],['remote',record('remote','screen','sam',false,true)]]);
  emitStreams();
  const first = emitted;
  // An unsubscribe while the watch update is pending must publish a final empty state.
  hideStream('remote'); const hidden = emitted;
  const pending = release; release = null; pending();
  await new Promise(resolve => setTimeout(resolve, 0));
  const serialized = [...changes];
  jo.attributes[WATCHING_ATTRIBUTE] = '["mine","screen"]';
  current.emit(RoomEvent.ParticipantAttributesChanged, {[WATCHING_ATTRIBUTE]:jo.attributes[WATCHING_ATTRIBUTE]}, jo);
  const updated = emitted;
  jo.name = 'Zoe'; emitStreams(); const renamed = emitted;
  // Simulate the server removing a disconnected participant before the event.
  current.remoteParticipants.delete('sam'); emitStreams(); const departed = emitted;
  jo.attributes[WATCHING_ATTRIBUTE] = '{invalid'; emitStreams(); const malformed = emitted;
  jo.attributes[WATCHING_ATTRIBUTE] = '[42]'; emitStreams(); const invalid = emitted;
  jo.attributes[WATCHING_ATTRIBUTE] = '["mine","mine"]'; emitStreams(); const duplicate = emitted;
  streams.set('local', record('local', 'new-share', 'me', true, true)); emitStreams(); const restarted = emitted;
  streams.get('remote').subscribed = true; emitStreams();
  await new Promise(resolve => setTimeout(resolve, 0));
  const beforeReconnect = changes.length; current.emit(RoomEvent.Reconnected);
  await new Promise(resolve => setTimeout(resolve, 0));
  return {first,hidden,serialized,updated,renamed,departed,malformed,invalid,duplicate,restarted,subscription,reannounced:changes.length>beforeReconnect};
};`
  await build({ stdin: { contents: source + probe, resolveDir: path.join(root, 'src/renderer/src'), loader: 'ts' }, bundle: true, format: 'iife', outfile: path.join(temp, 'probe.js') })
  await fs.writeFile(path.join(temp, 'probe.html'), '<script src="./probe.js"></script>')
  await app.whenReady()
  const engine = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } })
  await engine.loadFile(path.join(temp, 'probe.html'))
  const result = await engine.webContents.executeJavaScript('window.viewerProbe()')
  assert.deepEqual(result.first[0].viewers.map(person => person.name), ['Jordan', 'Sam'])
  assert.deepEqual(result.first[1].viewers.map(person => person.name), ['Alex'])
  assert.equal(result.hidden[1].viewers.length, 0)
  assert.deepEqual(result.serialized, ['["screen"]', ''])
  assert.deepEqual(result.updated[1].viewers.map(person => person.name), ['Jordan'])
  assert.deepEqual(result.renamed[1].viewers.map(person => person.name), ['Zoe'])
  assert.deepEqual(result.departed[0].viewers.map(person => person.name), ['Zoe'])
  assert.equal(result.malformed[0].viewers.length, 0)
  assert.equal(result.invalid[0].viewers.length, 0)
  assert.equal(result.duplicate[0].viewers.length, 1)
  assert.equal(result.restarted[0].viewers.length, 0)
  assert.equal(result.subscription, false)
  assert.equal(result.reannounced, true)
  console.log('PASS Per-stream presence, self-preview exclusion, hide races, attributes, names, departure, malformed state, share restart, and reconnect')

  await build({ entryPoints: [path.join(root, 'src/renderer/src/main.ts')], bundle: true, format: 'esm', outfile: path.join(temp, 'main.js'), plugins: [{ name: 'test-session', setup(build) { build.onResolve({ filter: /^\.\/session$/ }, () => ({ path: path.join(root, 'tests/ui-session.ts') })) } }] })
  const html = (await fs.readFile(path.join(root, 'src/renderer/index.html'), 'utf8')).replace('/src/styles.css', './styles.css').replace('/src/main.ts', './main.js').replaceAll('src="/logo.svg"', 'src="./logo.svg"')
  await fs.writeFile(path.join(temp, 'index.html'), html)
  await fs.copyFile(path.join(root, 'src/renderer/src/styles.css'), path.join(temp, 'styles.css'))
  await fs.copyFile(path.join(root, 'build/logo.svg'), path.join(temp, 'logo.svg'))
  const win = new BrowserWindow({ width: 1360, height: 860, show: false, frame: false, webPreferences: { preload: path.join(root, 'tests/ui-preload.cjs'), contextIsolation: true, sandbox: false, backgroundThrottling: false, offscreen: true } })
  engine.destroy()
  const run = code => win.webContents.executeJavaScript(code, true)
  async function check(code, label) { assert.ok(await run(code), label); console.log('PASS ' + label) }
  async function click(selector) { await run(`document.querySelector(${JSON.stringify(selector)}).click()`); await pause(100) }
  async function hover(selector) {
    const point = await run(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2)} })()`)
    win.webContents.sendInputEvent({ type: 'mouseMove', ...point }); await pause(100)
  }
  const output = path.join(root, 'release', 'ui-review'); await fs.mkdir(output, { recursive: true })
  await win.loadFile(path.join(temp, 'index.html')); await pause(350); await click('.room')
  await run(`window.viewerStreams = [
    {id:'local',participantId:'me',participantName:'Alex Morgan',local:true,muted:false,subscribed:true,viewers:[{id:'jo',name:'Jordan Lee',local:false},{id:'sam',name:'Sam Rivera',local:false}]},
    {id:'remote',participantId:'sam',participantName:'Sam Rivera',local:false,muted:false,subscribed:true,viewers:[{id:'me',name:'Alex Morgan',local:true}]},
    {id:'remote2',participantId:'jo',participantName:'Jordan Lee',local:false,muted:false,subscribed:false,viewers:[]}
  ]; window.uiTest.emitStreams(window.viewerStreams)`)
  await check(`document.querySelectorAll('#stream-grid .stream-viewers').length===2 && document.querySelector('[data-stream-id="local"] .stream-viewers-count').textContent==='2' && !document.querySelector('[data-stream-id="remote2"] .stream-viewers')`, 'Counters belong to each stream and disappear at zero')
  await check(`Array.from(document.querySelectorAll('#stream-grid .stream-viewers')).every(counter => {const r=counter.getBoundingClientRect(),t=counter.closest('.grid-tile').getBoundingClientRect(); return Math.abs((r.left+r.right-t.left-t.right)/2)<1 && Math.abs(r.top-t.top-13)<1 && getComputedStyle(counter.querySelector('.stream-viewers-dropdown')).display==='none'})`, 'Grid counters are centered at the top with closed dropdowns')
  await hover('[data-stream-id="local"] .stream-viewers-badge')
  await check(`getComputedStyle(document.querySelector('[data-stream-id="local"] .stream-viewers-dropdown')).display==='block'`, 'Mouse hover opens the viewer list')
  await hover('[data-stream-id="local"] .stream-viewers-list li')
  await check(`getComputedStyle(document.querySelector('[data-stream-id="local"] .stream-viewers-dropdown')).display==='block'`, 'Moving into the dropdown keeps the list open')
  await fs.writeFile(path.join(output, 'stream-viewers-grid.png'), (await win.webContents.capturePage()).toPNG())
  await click('[data-stream-id="local"] .stream-viewers')
  await check(`!document.querySelector('#stream-grid').hidden`, 'Clicking the counter does not focus the tile')
  await pause(1800)
  await check(`Array.from(document.querySelectorAll('#stream-grid .stream-viewers')).every(counter => Number(getComputedStyle(counter).opacity)<.1 && getComputedStyle(counter).pointerEvents==='none')`, 'Grid counters and dropdowns fade after 1.5 seconds without movement')
  await run(`window.savedVideos=[...document.querySelectorAll('#stream-grid video')]; window.viewerStreams[0].viewers=[{id:'sam',name:'Sam <script>',local:false}]; window.uiTest.emitStreams(window.viewerStreams)`)
  await check(`window.savedVideos.every(video=>[...document.querySelectorAll('#stream-grid video')].includes(video)) && document.querySelector('[data-stream-id="local"] .stream-viewers-count').textContent==='1' && document.querySelector('[data-stream-id="local"] li').textContent==='Sam <script>' && !document.querySelector('[data-stream-id="local"] script')`, 'Viewer changes preserve playback and safely display names')
  await click('[data-stream-id="local"]')
  await run(`window.viewerStreams[0].viewers=[]; window.uiTest.emitStreams(window.viewerStreams)`)
  await check(`document.querySelector('#stream-grid').hidden && window.uiTest.selected==='local' && document.querySelector('#focused-stream-viewers').hidden`, 'Viewer updates keep the local stream focused and hide its empty counter')
  await click('#stage-video')
  await click('[data-stream-id="remote"]')
  await check(`document.querySelector('#stream-grid').hidden && !document.querySelector('#focused-stream-viewers').hidden && document.querySelector('#focused-stream-viewers .stream-viewers-count').textContent==='1'`, 'Focused stream uses its own viewers')
  await click('#theater'); await hover('#focused-stream-viewers .stream-viewers-badge')
  await check(`(() => { const c=document.querySelector('#focused-stream-viewers'),r=c.getBoundingClientRect(),s=document.querySelector('#stage-wrap').getBoundingClientRect(); return document.body.classList.contains('theater') && Math.abs((r.left+r.right-s.left-s.right)/2)<1 && getComputedStyle(c.querySelector('.stream-viewers-dropdown')).display==='block' })()`, 'Focus view centers the counter and supports hover')
  await fs.writeFile(path.join(output, 'stream-viewers-focus.png'), (await win.webContents.capturePage()).toPNG())
  await hover('#stage-video')
  await check(`getComputedStyle(document.querySelector('#focused-stream-viewers .stream-viewers-dropdown')).display==='none'`, 'Moving away closes the dropdown')
  await pause(1800)
  await check(`Number(getComputedStyle(document.querySelector('#focused-stream-viewers')).opacity)<.1`, 'Focus counter follows the same inactivity timer')
  await run(`window.viewerStreams[1].viewers=[]; window.uiTest.emitStreams(window.viewerStreams)`)
  await check(`document.querySelector('#focused-stream-viewers').hidden`, 'Last viewer leaving hides the focused counter')
  await click('#exit-focus')
  await run(`window.uiTest.emitStreams([{...window.viewerStreams[2], viewers:[{id:'sam',name:'Sam Rivera',local:false}]}]); document.querySelector('#stage-wrap').dispatchEvent(new Event('pointermove',{bubbles:true}))`)
  await check(`!document.querySelector('#stream-grid').hidden && document.querySelector('.is-available .stream-viewers-count').textContent==='1'`, 'Available streams show people watching from other clients')
  await pause(1800)
  await check(`Number(getComputedStyle(document.querySelector('.is-available .stream-viewers')).opacity)<.1`, 'Available-stream counters fade even when no local video is playing')
  win.destroy(); clearTimeout(timeout); app.exit(0)
}
main().catch(error => { console.error(error); app.exit(1) })
