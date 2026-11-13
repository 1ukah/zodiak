// Linux dev/build and packaging must all use the same native helper.
if (process.platform === 'linux') require('./build-pipewire-audio.cjs')
