# Run from source

## Requirements

- 64-bit Windows.
- Node.js 22.12 or later in the 22.x series, with npm.
- .NET 8 SDK.
- A running [LiveKit server](livekit.md).

## Start Zodiak

Download or clone this project. Open PowerShell in the project folder and run:

```powershell
npm install
npm run build:system-audio-capture
npm run dev
```

The audio build command is necessary for screen audio. In the app, open **Server connection** and enter your LiveKit server URL, API key, and secret.

## Build the installer

In the project folder, run:

```powershell
npm run pack
```

This command builds the app and creates `dist/zodiak-setup.exe`.
