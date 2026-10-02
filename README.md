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
- Talk in the current room, mute your microphone, deafen, or mute a participant's voice for yourself.
- Dock chat on the right or bottom, hide it with unread badges, and optionally preview incoming messages in compact bubbles.

## How rooms work

Set a display name, select a room, and join it. Anyone in the room can view active screen shares and can start their own screen share. Rooms accept names made of letters, numbers, dashes, and underscores. Leaving a room only disconnects you; deleting a room is a separate, deliberate action.

Zodiak publishes screens, screen audio, microphone audio, and chat data within the connected LiveKit room. It does not publish cameras. Whispers are addressed only to the selected participant in that room.

Voice starts with your microphone muted each time you join a room. Use the microphone and headphones buttons beside your profile (or in the controls in focus view) to mute and deafen. Deafening silences incoming voices and automatically mutes your microphone; undeafening restores its previous mute state. Voice controls do not affect shared screen audio. In the Audio settings tab, disable voice entirely or select a Windows microphone; save to apply the change. Input volume adjusts your transmitted microphone audio from 0% to 100% and is saved locally. Its live preview reverts when settings are closed without saving. The output selector and output volume apply to both voices and screen audio, with output volume supporting up to 200%.

The participant list shows microphone and headphones status, and a green avatar border with a white name while someone is speaking. Hover or focus a participant's row to mute their voice for yourself. A red microphone marks your local mute; other people see only that participant's own mute/deafen status. Local participant mutes last for the current room session. Leaving or switching rooms stops microphone capture and voice playback.

Chat starts with the room tab. Use the message icon beside a participant to open a private tab; only private tabs can be closed. Consecutive messages from the same sender group together. Links open in your browser, images preview inline, and supported videos load when clicked. Use the chat icon (or Ctrl+Shift+C) to show or hide the panel. Chat always opens on the right. **Show chat bubbles** is saved in the Interface settings tab.

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

Voice checks: `npm run test:voice` verifies real WebRTC playback, microphone lifecycle, mute/deafen behavior, settings, and participant indicators with a fake microphone. `npm run test:voice:live` uses the same three `LIVEKIT_*` variables to verify production tokens and room voice delivery in three Electron clients, including screen-audio independence and room isolation. It removes its temporary test rooms.

`npm run pack` creates the Windows installer at `dist/zodiak-setup.exe`. Building the installer also requires the .NET 8 SDK for the system-audio helper.

## Update channels and releases

In **Settings → System → Update channel**, choose **Stable** (the default) or **Beta**, then save. Startup checks use the saved channel. **Check for updates now** checks the currently selected channel, even before saving. Closing settings discards an unsaved channel change. Beta offers early features and may be less stable; switching back to Stable allows installing the stable version even if its version is older than the installed beta.

Updates download built installers from GitHub Releases. Creating or pushing to a branch alone does not publish an update. Stable uses regular releases from `master`; Beta uses only `-beta` prereleases from `beta`, without falling back to a stable or alpha release.

To publish, update `VERSION` on the appropriate branch, run `npm run version:sync`, commit, and push the matching tag. For example, use `1.2.0-beta` and tag `v1.2.0-beta` on `beta`, then `1.2.1-beta` / `v1.2.1-beta` for the next Beta update. When promoting it to Stable on `master`, use `1.2.1` / `v1.2.1`. Increase the version for each release. The release workflow verifies the tag against `VERSION` and the source branch, builds the installer, and publishes `latest.yml` for Stable or `beta.yml` for Beta. Beta releases are marked as prereleases and never replace the latest Stable release. The publication script requires an existing tag that matches the source being packaged.

## Screenshot

<img width="1920" height="1032" alt="zodiak_NuQeg2SrVu" src="https://github.com/user-attachments/assets/cdd212d1-d369-40d7-b37e-89a909978273" />

