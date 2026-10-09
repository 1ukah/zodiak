# Run from source

## Requirements

- 64-bit Windows, or Arch Linux x86_64 with KDE Wayland.
- Node.js 22.12 or later in the 22.x series, with npm.
- .NET 8 SDK on Windows only. Linux does not need .NET.
- A running [LiveKit server](livekit.md).

## Start Zodiak

Download or clone this project. On Windows, open PowerShell in the project folder and run:

```powershell
npm ci
npm run build:system-audio-capture
npm run dev
```

The audio build command is necessary for screen audio. In the app, open **Server connection** and enter your LiveKit server URL, API key, and secret.

### Linux

KDE Wayland needs PipeWire, WirePlumber, and the KDE desktop portal. Install missing packages with your system package manager. On Arch, use:

```bash
sudo pacman -S --needed pipewire wireplumber xdg-desktop-portal xdg-desktop-portal-kde
```

Do not replace an existing audio setup without checking its configuration. Log out and log in again if you install the portal for the first time.

Open a terminal in the project folder and run:

```bash
npm ci
npm run dev
```

This command opens the graphical application. Set your name in **Settings**. Open **Server connection** and enter your LiveKit server URL, API key, and secret. Create or join a room. Select **Share**. Select the video quality, then start the share. KDE opens its screen or window selection dialog.

For the first screen-share test, select 720p and 15 FPS. This setting passed the real KDE capture test. Higher frame rates and hardware video processing still need a test.

Linux sends screen video without system audio. System audio and Discord exclusion are disabled. Received screen audio, voice chat, and text chat keep their existing code. Automatic application updates are disabled on Linux. Install a new package to update the app.

Linux stores its settings in Electron's user folder. This is normally `$XDG_CONFIG_HOME/zodiak` or `~/.config/zodiak`. It does not store settings beside the installed executable.

## Build the Windows Installer

In the project folder, run:

```powershell
npm run pack
```

This command builds the app and creates `dist/zodiak-setup.exe`.

## Build Linux Packages

These commands do not build or include the Windows audio helper.

```bash
npm run pack:linux
```

This makes an AppImage and a `.tar.gz` archive in `dist/`. For version 1.3.1 on x86_64:

```bash
chmod +x dist/zodiak-1.3.1-linux-x86_64.AppImage
./dist/zodiak-1.3.1-linux-x86_64.AppImage
```

If FUSE is not available, use:

```bash
./dist/zodiak-1.3.1-linux-x86_64.AppImage --appimage-extract-and-run
```

For a directory package only, use `npm run pack:linux:dir`. Start it with `./dist/linux-unpacked/zodiak`.

For an Arch installer package, use:

```bash
sudo pacman -S --needed libxcrypt-compat
npm run pack:linux:arch
```

`libxcrypt-compat` is a build dependency for electron-builder's package tool. It is not an application dependency. See the [Arch package file list](https://archlinux.org/packages/core/x86_64/libxcrypt-compat/files/).

Install the resulting `.pacman` file with `sudo pacman -U`, then start `zodiak` from the application menu or a terminal. Check the actual filename in `dist/`. Use `sudo pacman -R zodiak` to remove the package. Package installation and removal still need a test on this computer.

All package commands copy the version from `VERSION` to the package metadata. No command above publishes a release.

## Linux Branch Builds

Each push to `feat/linux` starts the **Build Linux branch packages** workflow.
It checks types and capture behavior, then builds the AppImage, archive, and Arch package.
It does not need a release tag or a commit on `master`.

To get the packages:

1. Push your committed changes with `git push origin feat/linux`.
2. Open the repository's **Actions** tab.
3. Open the successful **Build Linux branch packages** run.
4. Download the `zodiak-linux-<run-number>-<attempt>` file in **Artifacts**.
5. Extract the downloaded ZIP file.

The packages are kept for seven days.
A new push cancels an older branch build that is still running.
The package version comes from `VERSION`. You do not need to change it for each test build.

After extraction, make the AppImage executable with `chmod +x` before you start it.
Use `--appimage-extract-and-run` if FUSE is not available.
The archive and Arch package use the installation instructions above.

These are test builds. They do not create or change a GitHub release.
They do not build Windows or change its update feed.
Linux automatic updates remain disabled. Download a new build to update it.
The normal `v*` tag-release workflow is unchanged.

## Check the Linux Changes

```bash
npm run typecheck
npm run build
npm run test:linux
node tests/linux-package.cjs dist/linux-unpacked/zodiak
```

The capture test uses simulated portal responses. The package test opens the real application twice with temporary user folders. It checks settings, identity, and participant volumes. It does not change your normal settings.

For the local LiveKit video test and the checks that remain, see [Linux support](linux-port.md).
