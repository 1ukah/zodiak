// Test-only Electron bootstrap. Mute device output before any page can play,
// while leaving audio graphs running for sample/volume/processing assertions.
const electron = require('electron')
const assert = require('node:assert/strict')
const { app } = electron

assert.equal(app.isReady(), false, 'Load the silent test bootstrap before Electron is ready')
app.commandLine.appendSwitch('mute-audio')
app.on('web-contents-created', (_event, contents) => {
  contents.setAudioMuted(true)
  assert.equal(contents.isAudioMuted(), true, 'Every test page must be muted before loading')
})

module.exports = electron
