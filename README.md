# Zodiak

Zodiak is a Windows desktop app for sharing screens with people in rooms on a LiveKit server.

## What it does

- Browse, create, join, and delete rooms.
- Watch one or several live screen shares in a room.
- Share a screen or window with optional system audio.
- Choose the playback device and volume for incoming stream audio.
- Optionally exclude Discord audio from a system-audio share.

## How rooms work

Set a display name, select a room, and join it. Anyone in the room can view active screen shares and can start their own screen share. Rooms accept names made of letters, numbers, dashes, and underscores. Leaving a room only disconnects you; deleting a room is a separate, deliberate action.

Zodiak is designed for screen sharing. It does not publish cameras, microphones, chat messages, or other participant data.

## Connect to a server

Open **Server connection** in the app and provide the URL, API key, and API secret for your LiveKit server. These settings are saved locally for the current user.

## Run from source

Requires Node.js and 64-bit Windows.

```powershell
npm install
npm run dev
```

Useful commands:

```powershell
npm run typecheck
npm run build
npm run pack
```

`npm run pack` creates the Windows installer at `dist/zodiak-setup.exe`. Building the installer also requires the .NET 8 SDK for the system-audio helper.
