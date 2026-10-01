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
- Chat with the current room or whisper privately to another participant.
- Dock chat on the right or bottom, hide it with unread badges, and optionally preview incoming messages in compact bubbles.

## How rooms work

Set a display name, select a room, and join it. Anyone in the room can view active screen shares and can start their own screen share. Rooms accept names made of letters, numbers, dashes, and underscores. Leaving a room only disconnects you; deleting a room is a separate, deliberate action.

Zodiak publishes screens, screen audio, and chat data within the connected LiveKit room. It does not publish cameras or microphones. Whispers are addressed only to the selected participant in that room.

Chat starts with the room tab. Use the message icon beside a participant to open a private tab; only private tabs can be closed. Consecutive messages from the same sender group together. Links open in your browser, images preview inline, and supported videos load when clicked. Use the chat icon (or Ctrl+Shift+C) to show or hide the panel. Position and **Show chat bubbles** are saved in settings.

Chat history is held only in app memory (up to 500 messages per tab), separately for each server and room. Leaving or switching rooms keeps the messages you received while connected, along with open whisper tabs and drafts; returning restores them. Closing the app or losing the LiveKit server clears all cached history. There is no server history or offline delivery: messages sent while you are away are not added when you return. Closing a whisper discards its local history; a new incoming whisper opens its tab again.

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

Chat checks: `npm run test:chat` validates the protocol and UI. `npm run test:chat:live` connects four Electron clients using `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` environment variables, verifies room/whisper delivery, and removes its temporary test rooms.

`npm run pack` creates the Windows installer at `dist/zodiak-setup.exe`. Building the installer also requires the .NET 8 SDK for the system-audio helper.

## Screenshot

<img width="1920" height="1032" alt="zodiak_NuQeg2SrVu" src="https://github.com/user-attachments/assets/cdd212d1-d369-40d7-b37e-89a909978273" />

