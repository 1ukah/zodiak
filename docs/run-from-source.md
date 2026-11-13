# Run from source

## Requirements

- 64-bit Windows, or x86_64 Linux with glibc.
- Node.js 22.12 or later, with npm.
- Windows: .NET 8 SDK (for the system-audio helper).
- Linux: a C compiler, `pkg-config` and the PipeWire development headers (for the system-audio helper). For screen sharing on Wayland, the desktop portal for your desktop (`xdg-desktop-portal-kde`, `xdg-desktop-portal-gnome`, ...).
- A running [zodiak-api](https://github.com/1ukah/zodiak-api) and zodiak-media. See its README.

## Start Zodiak

### Windows

Open PowerShell in the project folder and run:

```powershell
npm install
npm run build:system-audio-capture
npm run dev
```

### Linux

Install the PipeWire headers first. On Arch: `sudo pacman -S --needed base-devel pipewire`. On Debian or Ubuntu: `sudo apt install build-essential pkg-config libpipewire-0.3-dev`. Then run:

```bash
npm install
npm run dev
```

`npm run dev` and `npm run build` compile the PipeWire helper (`native/pipewire-audio`) first.

### API address

Development builds connect to `http://127.0.0.1:8080`. To use another API, set `ZODIAK_API_URL` before `npm run dev`.
For an HTTPS development server, also set `ZODIAK_API_CA` to the path of the server's CA certificate.
Installed builds always connect to `https://zodiak.emono.host:20005` and trust only `resources/zodiak-ca.pem`.

## Linux notes

- Wayland: the app has no source list. **Share** opens the desktop's own screen or window picker (xdg-desktop-portal).
- X11: the app shows its own source list, as on Windows.
- System audio is captured from PipeWire. Zodiak's own playback is never captured, and **Exclude Discord** removes Discord (including Flatpak builds). Local playback is not changed.
- Settings and the session are saved in `~/.config/zodiak` (`$XDG_CONFIG_HOME/zodiak`). The session is encrypted with KWallet or the Secret Service keyring. Without a keyring it is only obfuscated, and readable only by your user.
- Automatic updates work only in the AppImage. `npm run pack:linux:dir` builds, and extracted AppImages, cannot update themselves.
- If the AppImage cannot mount (no FUSE), run it with `--appimage-extract-and-run`. On NixOS, use `appimage-run` or enable `programs.appimage`.

## After the API protocol changes

```powershell
npm run protocol:sync
```

This copies the TypeScript types that zodiak-api generates into `src/shared/protocol`.

## Tests

| Command | What it checks |
|---|---|
| `npm run test:unit` | Live-event state, request checks, invite parsing (Vitest). |
| `npm run test:startup` | Production startup, preload and IPC. |
| `npm run test:updater` | Update checks, downloads and installs for Windows and the Linux AppImage. |
| `npm run test:capture` | Wayland portal capture, X11/Windows source selection, and the system-audio helper lifecycle. |
| `npm run test:pipewire` | Linux only. The PipeWire helper against a private PipeWire daemon (never your real audio). |
| `npm run test:e2e` | Register, servers, text chat and logout against a running API on port 18080. |
| `npm run test:e2e:voice` | Voice and screen share between two app processes, against a running API and media server. |

## Build the installer

Put the server CA certificate at `build/zodiak-ca.pem` first.

Windows:

```powershell
npm run pack
```

This command builds the app and creates `dist/zodiak-setup.exe`.

Linux:

```bash
npm run pack:linux
```

This command builds `dist/zodiak-linux-x86_64.AppImage` and its update manifest (`dist/latest-linux.yml`, or `beta-linux.yml` for a beta version). Build on the oldest distribution you want to support: the AppImage needs a glibc at least as new as the one it was built with.

## Release

Push a tag `v<VERSION>`. The release workflow builds the AppImage on Ubuntu 22.04 and the setup on Windows, then publishes both, with their update manifests, in one GitHub release.
