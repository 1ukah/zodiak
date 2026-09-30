# Zodiak

<p align="center">
  <img width="96" height="96" alt="icon" src="https://github.com/user-attachments/assets/6fe87a16-b1f6-4c1d-8511-89a476d38c81" />
</p>


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

## Screenshot

<img width="1920" height="1032" alt="zodiak_NuQeg2SrVu" src="https://github.com/user-attachments/assets/cdd212d1-d369-40d7-b37e-89a909978273" />

