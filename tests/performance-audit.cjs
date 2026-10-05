// Profiles the real production entry point with an isolated offline profile.
// Run after npm run build: npx electron tests/performance-audit.cjs
const { app, desktopCapturer, nativeImage } = require('./silent-electron.cjs')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { pathToFileURL } = require('node:url')
const http = require('node:http')
const root = path.resolve(__dirname, '..')
const profileDirectory = require('node:fs').mkdtempSync(path.join(os.tmpdir(), 'zodiak-performance-'))
app.setPath('userData', profileDirectory)
app.setPath('sessionData', path.join(profileDirectory, 'session'))
const mode = process.argv.includes('--software-gpu') ? 'software-gpu' : 'default'
if (mode === 'software-gpu') app.disableHardwareAcceleration()
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const started = performance.now()
const result = { mode, versions: process.versions, scenarios: [], sources: [] }
result.startupSamples = []
result.imageLoads = []
if (process.argv.includes('--startup-only')) {
  const createFromPath = nativeImage.createFromPath.bind(nativeImage)
  nativeImage.createFromPath = file => {
    const before=performance.now()
    try {
      const icon = createFromPath(file)
      result.imageLoads.push({file:path.basename(file),size:icon.getSize()})
      return icon
    }
    finally { result.imageLoads.push({file:path.basename(file),elapsedMs:performance.now()-before}) }
  }
}
let startupSampler
app.whenReady().then(() => {
  app.getAppMetrics()
  let previous = performance.now()
  startupSampler = setInterval(() => {
    const now = performance.now()
    const processes = app.getAppMetrics().map(p => ({ pid:p.pid, type:p.type, cpuPercent:p.cpu.percentCPUUsage, cumulativeCpuSeconds:p.cpu.cumulativeCPUUsage }))
    result.startupSamples.push({atMs:now-started,intervalMs:now-previous,processes})
    previous=now
  }, 100)
})
const stubServer = process.argv.includes('--stub-server')
result.requests = []
const timeout = setTimeout(() => { console.error('Performance audit timed out'); app.exit(1) }, 120000)
const measureScript = `(() => {
  const state = window.__perfAudit = { longTasks: [], timerLags: [], mutations: 0 };
  state.observer = new PerformanceObserver(list => { for (const e of list.getEntries()) state.longTasks.push(e.duration) });
  state.observer.observe({type:'longtask'});
  state.mutationsObserver = new MutationObserver(list => { state.mutations += list.length });
  state.mutationsObserver.observe(document.body, {subtree:true,childList:true,attributes:true,characterData:true});
  let last = performance.now();
  state.timer = setInterval(() => { const now=performance.now(); state.timerLags.push(Math.max(0,now-last-100)); last=now },100);
})()`
async function scenario(win, name, setup) {
  if (setup) await setup()
  await delay(500)
  await win.webContents.executeJavaScript(measureScript)
  app.getAppMetrics() // Prime the CPU interval.
  const samples = []
  for (let i = 0; i < 8; i++) {
    await delay(1000)
    samples.push(app.getAppMetrics().map(p => ({ pid: p.pid, type: p.type, cpuPercent: p.cpu.percentCPUUsage, workingSetKiB: p.memory.workingSetSize, privateKiB: p.memory.privateBytes })))
  }
  const renderer = await win.webContents.executeJavaScript(`(() => {
    const s=window.__perfAudit; clearInterval(s.timer); s.observer.disconnect(); s.mutationsObserver.disconnect();
    const sorted=s.timerLags.slice().sort((a,b)=>a-b);
    return {longTaskCount:s.longTasks.length,longTaskTotalMs:s.longTasks.reduce((a,b)=>a+b,0),maxLongTaskMs:Math.max(0,...s.longTasks),timerLagP95Ms:sorted[Math.floor(sorted.length*.95)]||0,maxTimerLagMs:Math.max(0,...s.timerLags),mutationRecords:s.mutations,jsHeapBytes:performance.memory?.usedJSHeapSize,visibility:document.visibilityState};
  })()`)
  const entry = { name, samples, renderer, minimized: win.isMinimized(), visible: win.isVisible(), focused: win.isFocused(), requestCount: result.requests.length }
  result.scenarios.push(entry)
  console.log(JSON.stringify({ name, averageCpuPercent: samples.reduce((s,ps)=>s+ps.reduce((sum,p)=>sum+p.cpuPercent,0),0)/samples.length, workingSetMiB: samples.at(-1).reduce((s,p)=>s+p.workingSetKiB,0)/1024, renderer, minimized:entry.minimized,requestCount:entry.requestCount }))
}
async function profile(win) {
  result.startupToShowMs = performance.now() - started
  if (process.argv.includes('--startup-only')) {
    await delay(4000)
    clearInterval(startupSampler)
    const totals=result.startupSamples.map(s=>s.processes.reduce((sum,p)=>sum+p.cpuPercent,0))
    const output=path.join(root,'release','performance-audit')
    await fs.mkdir(output,{recursive:true})
    await fs.writeFile(path.join(output,'startup-'+mode+'.json'),JSON.stringify(result,null,2)+'\n')
    console.log(JSON.stringify({mode,startupToShowMs:result.startupToShowMs,sampleCount:totals.length,peakAppCpuPercent:Math.max(0,...totals),largestSamplingGapMs:Math.max(0,...result.startupSamples.map(s=>s.intervalMs)),imageLoads:result.imageLoads,peakProcessSamples:result.startupSamples.flatMap(s=>s.processes.map(p=>({...p,atMs:s.atMs}))).sort((a,b)=>b.cpuPercent-a.cpuPercent).slice(0,5)}))
    clearTimeout(timeout);app.exit(0);return
  }
  clearInterval(startupSampler)
  await delay(1000)
  result.gpuFeatures = app.getGPUFeatureStatus()
  const gpu = await app.getGPUInfo(process.argv.includes('--gpu-only') ? 'complete' : 'basic')
  result.gpu = { gpuDevice: gpu.gpuDevice, auxAttributes: gpu.auxAttributes }
  if (process.argv.includes('--gpu-only')) {
    const output=path.join(root,'release','performance-audit')
    await fs.mkdir(output,{recursive:true})
    await fs.writeFile(path.join(output,'gpu-complete.json'),JSON.stringify(gpu,null,2)+'\n')
    console.log(JSON.stringify({devices:gpu.gpuDevice,renderer:gpu.auxAttributes?.glRenderer,initializationTimeMs:gpu.auxAttributes?.initializationTime}));clearTimeout(timeout);app.exit(0);return
  }
  await scenario(win, 'lobby-visible')
  await scenario(win, 'lobby-minimized', async () => win.minimize())
  win.restore(); win.show(); win.focus()
  await scenario(win, 'settings-dialog', async () => { await win.webContents.executeJavaScript(`document.querySelector('#lobby-settings').click()` ) })
  await win.webContents.executeJavaScript(`document.querySelector('#settings-dialog').close()`)
  for (const size of [{width:360,height:202},{width:0,height:0}]) {
    for (let i=0;i<3;i++) {
      const t=performance.now()
      const sources=await desktopCapturer.getSources({types:['screen','window'],thumbnailSize:size,fetchWindowIcons:false})
      result.sources.push({ size, elapsedMs:performance.now()-t, count:sources.length })
    }
  }
  const output=path.join(root,'release','performance-audit')
  await fs.mkdir(output,{recursive:true})
  await fs.writeFile(path.join(output,mode+(stubServer?'-stub-server':'')+'.json'),JSON.stringify(result,null,2)+'\n')
  console.log(JSON.stringify({startupToShowMs:result.startupToShowMs,gpuFeatures:result.gpuFeatures,sources:result.sources}))
  clearTimeout(timeout)
  app.exit(0)
}
async function main() {
  let url = ''
  if (stubServer) {
    const server=http.createServer((request,response)=>{
      let bodyBytes=0
      request.on('data',chunk=>{bodyBytes+=chunk.length})
      request.on('end',()=>{
        const body=JSON.stringify({rooms:[]})
        result.requests.push({path:request.url,method:request.method,atMs:performance.now()-started,bodyBytes,responseBytes:Buffer.byteLength(body)})
        response.writeHead(200,{'Content-Type':'application/json'});response.end(body)
      })
    })
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
    url='ws://127.0.0.1:'+server.address().port
  }
  await fs.writeFile(path.join(profileDirectory,'config.json'),JSON.stringify({url,apiKey:stubServer?'test':'',apiSecret:stubServer?'test':'',displayName:'Performance audit',checkForUpdatesOnStartup:false}))
  app.on('browser-window-created',(_event,win)=>{
    if(win.getBounds().width===360)return
    win.once('show',()=>{ void profile(win).catch(error=>{console.error(error);app.exit(1)}) })
  })
  await import(pathToFileURL(path.join(root,'out/main/index.js')).href)
}
main().catch(error=>{console.error(error);app.exit(1)})
