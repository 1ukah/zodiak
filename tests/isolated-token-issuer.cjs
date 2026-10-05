// Live checks simulate separate installations, each with its own stored UUID.
const fs = require('node:fs/promises')
const path = require('node:path')
exports.createTokenIssuer = async (bundlePath, profile, config) => {
  await fs.mkdir(profile, {recursive:true})
  await fs.writeFile(path.join(profile,'config.json'),JSON.stringify(config),'utf8')
  const bundle = await fs.readFile(bundlePath,'utf8')
  const module = {exports:{}}
  new Function('require','module','exports',bundle)(id => id === 'electron' ? {app:{getPath:()=>profile}} : require(id),module,module.exports)
  return module.exports
}
