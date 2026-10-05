const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const {build} = require('esbuild')
const {createTokenIssuer} = require('./isolated-token-issuer.cjs')
const root = path.resolve(__dirname,'..')

async function main() {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(),'zodiak-preferences-'))
  try {
    const bundles = await Promise.all(['identity','participant-preferences','tokens'].map(async name => {
      const result = await build({entryPoints:[path.join(root,`src/main/${name}.ts`)],bundle:true,platform:'node',format:'cjs',write:false,external:['electron']})
      return result.outputFiles[0].text
    }))
    const profile = path.join(temporary,'first')
    function load(bundle, directory=profile) {
      const module = {exports:{}}
      new Function('require','module','exports',bundle)(id=>id==='electron'?{app:{getPath:()=>directory}}:require(id),module,module.exports)
      return module.exports
    }
    const identity = load(bundles[0])
    const ids = await Promise.all(Array.from({length:12},()=>identity.getLocalIdentity()))
    assert.equal(new Set(ids).size,1,'Concurrent initialization must generate only one identity')
    const uuid = ids[0]
    assert.match(uuid,/^[0-9a-f-]{36}$/)
    assert.equal(JSON.parse(await fs.readFile(path.join(profile,'identity.json'),'utf8')).uuid,uuid)
    assert.equal(await load(bundles[0]).getLocalIdentity(),uuid,'Reloading the app must retain its UUID')
    const otherProfile = path.join(temporary,'second')
    assert.notEqual(await load(bundles[0],otherProfile).getLocalIdentity(),uuid,'Separate installations need different IDs')
    const tokenPath = path.join(temporary,'tokens.cjs')
    await fs.writeFile(tokenPath,bundles[2])
    const config = {url:'ws://localhost:7880',apiKey:'test',apiSecret:'test-secret'}
    const issuer = await createTokenIssuer(tokenPath,profile,config)
    const tokens = await Promise.all([
      issuer.createParticipantToken({role:'viewer',displayName:'Alex',room:'first'}),
      issuer.createParticipantToken({role:'publisher',displayName:'Renamed',room:'second'}),
    ])
    assert(tokens.every(token=>token.identity===uuid))
    for(const [index,token] of tokens.entries()) {
      const claims = JSON.parse(Buffer.from(token.token.split('.')[1],'base64url').toString())
      assert.equal(claims.sub,uuid)
      assert.equal(claims.name,index===0?'Alex':'Renamed')
    }
    const freshIssuer = await createTokenIssuer(tokenPath,profile,config)
    assert.equal((await freshIssuer.createParticipantToken({role:'viewer',displayName:'Again',room:'third'})).identity,uuid)
    console.log('PASS UUID is generated once, survives restart, and stays stable across rooms, roles, and name changes in actual LiveKit tokens')

    const api = load(bundles[1])
    const server = 'ws://localhost:7880'
    const friend = await load(bundles[0],otherProfile).getLocalIdentity()
    const third = await load(bundles[0],path.join(temporary,'third')).getLocalIdentity()
    assert.deepEqual(Object.keys(await api.getParticipantPreferences(server)),[])
    await Promise.all([
      api.saveParticipantPreferences({server,participants:[{id:friend,name:'Sam',volume:.35}]}),
      api.saveParticipantPreferences({server,participants:[{id:third,name:'Sam',volume:0}]}),
    ])
    const saved = await load(bundles[1]).getParticipantPreferences('http://LOCALHOST:7880/')
    assert.deepEqual(saved[friend],{name:'Sam',volume:.35})
    assert.deepEqual(saved[third],{name:'Sam',volume:0})
    await api.saveParticipantPreferences({server,participants:[{id:friend,name:'New name'}]})
    assert.deepEqual((await api.getParticipantPreferences(server))[friend],{name:'New name',volume:.35})
    await api.saveParticipantPreferences({server:'wss://elsewhere.test',participants:[{id:friend,name:'New name',volume:.8}]})
    assert.equal((await api.getParticipantPreferences(server))[friend].volume,.35)
    assert.equal((await api.getParticipantPreferences('https://elsewhere.test/'))[friend].volume,.8)
    assert.deepEqual(Object.keys(await load(bundles[1],otherProfile).getParticipantPreferences(server)),[],'Listening preferences belong to the local profile')
    console.log('PASS Names and volumes persist by server and UUID, distinguish duplicate names, preserve zero, and update names without losing volume')

    await Promise.all(Array.from({length:20},(_,index)=>api.saveParticipantPreferences({server,participants:[{id:friend,name:'New name',volume:index/20}]})))
    await api.flushParticipantPreferences()
    assert.equal((await load(bundles[1]).getParticipantPreferences(server))[friend].volume,.95)
    assert.equal((await api.getParticipantPreferences(server))[third].volume,0)
    assert.equal(JSON.parse(await fs.readFile(path.join(profile,'identity.json'),'utf8')).uuid,uuid,'Preference writes must not overwrite identity')
    assert((await fs.readdir(profile)).every(name=>!name.endsWith('.tmp')),'Atomic writes must clean temporary files')
    await assert.rejects(async()=>api.saveParticipantPreferences({server,participants:[{id:friend,name:'New name',volume:NaN}]}),/Invalid participant volume/)
    await api.saveParticipantPreferences({server,participants:[{id:friend,name:'New name',volume:5}]})
    assert.equal((await api.getParticipantPreferences(server))[friend].volume,1)
    // Dictionary keys received over IPC cannot interfere with object prototypes.
    await api.saveParticipantPreferences({server,participants:[{id:'__proto__',name:'Legacy client',volume:.2}]})
    assert.equal((await api.getParticipantPreferences(server))['__proto__'].volume,.2)
    console.log('PASS Rapid updates serialize without losing other users, validate volumes, and replace JSON atomically')

    await fs.writeFile(path.join(profile,'participant-volumes.json'),'{broken')
    assert.deepEqual(Object.keys(await api.getParticipantPreferences(server)),[])
    await api.saveParticipantPreferences({server,participants:[{id:friend,name:'Recovered',volume:.6}]})
    assert.equal((await load(bundles[1]).getParticipantPreferences(server))[friend].volume,.6)
    assert.equal(await load(bundles[0]).getLocalIdentity(),uuid)
    await fs.writeFile(path.join(otherProfile,'identity.json'),'{}')
    assert.notEqual(await load(bundles[0],otherProfile).getLocalIdentity(),friend)
    const inaccessible = path.join(temporary,'invalid-path')
    await fs.mkdir(path.join(inaccessible,'identity.json'),{recursive:true})
    await assert.rejects(load(bundles[0],inaccessible).getLocalIdentity(),error=>error.code==='EISDIR'||error.code==='EPERM')
    console.log('PASS Missing or malformed files recover; actual filesystem errors are surfaced without silently changing identity')
  } finally {
    assert(path.resolve(temporary).startsWith(path.resolve(os.tmpdir())+path.sep))
    await fs.rm(temporary,{recursive:true,force:true})
  }
}
main().catch(error=>{console.error(error);process.exitCode=1})
