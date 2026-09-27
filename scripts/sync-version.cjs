const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const version = fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim();

// Keep this compatible with the version format accepted by npm/electron-builder.
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(version)) {
  throw new Error(`VERSION must contain a semantic version without a leading "v"; received "${version}".`);
}

function updateJson(relativePath, update) {
  const file = path.join(root, relativePath);
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  const original = JSON.stringify(json);
  update(json);
  if (JSON.stringify(json) !== original) {
    fs.writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
  }
}

updateJson('package.json', (pkg) => {
  pkg.version = version;
});

updateJson('package-lock.json', (lockfile) => {
  lockfile.version = version;
  if (lockfile.packages?.['']) lockfile.packages[''].version = version;
});

console.log(`Synchronized package metadata to ${version}.`);
