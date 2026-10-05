// Match Vite's raw asset imports when production renderer code is bundled for
// Electron integration tests. In particular, RNNoise's worklet embeds its WASM.
const esbuild = require('esbuild')
const fs = require('node:fs/promises')
const rawImports = {
  name: 'raw-imports',
  setup(build) {
    build.onResolve({ filter: /\?raw$/ }, args => ({
      path: require.resolve(args.path.slice(0, -4), { paths: [args.resolveDir] }), namespace: 'raw',
    }))
    build.onLoad({ filter: /.*/, namespace: 'raw' }, async args => ({ contents: await fs.readFile(args.path, 'utf8'), loader: 'text' }))
  },
}
exports.build = options => esbuild.build({ ...options, plugins: [...(options.plugins || []), rawImports] })
