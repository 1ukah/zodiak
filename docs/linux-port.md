# Linux Support

Research and implementation date: 2026-10-08. Base source revision: `1af9685`.
The Linux changes are in the current working tree.

## Main Result

We can add Linux support to Zodiak.
We can keep Electron, LiveKit, and most application code.
Some features need changes or a separate Linux implementation.

The first target is **Arch Linux x86_64 with KDE Wayland**.
The first Linux version must let you:

- Open the application.
- Connect to your LiveKit server.
- Create or join a room.
- Watch another person's screen share.
- Share your screen or a window as video.

Outgoing system audio and Discord exclusion can come later.
An installer is preferred.
Starting the graphical application from a terminal is acceptable for the first version.

The first Linux implementation is complete.
It includes the Wayland selection path, Linux controls, writable data folders, and package commands.
Some release tests are still necessary.

## What We Can and Cannot Port

Here, **port** means change software so that it works on another operating system.
**Use existing code** does not mean that all tests are complete.

| Feature | Can we use the Windows implementation on Linux? | Result or necessary change |
| --- | --- | --- |
| Application interface | Yes. Use the existing Electron interface. | The application started on Linux. |
| LiveKit connection | Yes. Use the existing connection code. | The application code connected to a local LiveKit server. |
| Room creation and room list | Yes. Use the existing room code. | Both operations passed with a local LiveKit server. |
| Join a room | Yes. Use the existing connection and access-token code. | Two Linux clients joined the same room. |
| Watch a screen share | Yes. Use the existing video receiver and player. | Received video passed. A real Windows screen share still needs a test. |
| Share your screen or window | Partly. Keep the LiveKit video code. Use the new Linux selection path. | The real KDE capture test passed. The receiver displayed the selected source through LiveKit. |
| Hear another person's screen audio | Yes. Use the existing audio receiver and player. | The audio playback test passed. Audio from a real Windows share still needs a test. |
| Send your computer's system audio | No. The current capture helper requires Windows. | Both the interface and main process disable this feature on Linux. Video sharing remains enabled. |
| Exclude Discord audio | No. The current exclusion code requires Windows audio APIs. | Add a separate Linux implementation later. |
| Voice chat | Yes. Keep the LiveKit and WebRTC code. | Automated voice, processing, and interface tests passed. A real microphone and another person's voice still need a test. |
| Text chat and private messages | Yes. Use the existing LiveKit data code. | Message delivery passed. One test for a person who left the room failed. |
| Images in chat | Yes. Use the existing image-transfer code. | Public and private image delivery passed. |
| Current Windows installer | No. The WPF/NSIS installer cannot run directly on Linux. | Keep it for Windows. Add a Linux package. |
| Linux download | Yes. Use separate Linux packages. | Directory and AppImage startup passed. Settings remained after restart. An Arch package was built. |
| Automatic updates | Partly. The update library supports Linux. | Linux update controls and actions are disabled. Install a new package to update. Windows keeps its updater. |
| Saved settings and identity | Yes. Keep the data files and their formats. | Linux uses Electron's writable user folders. The package restart test passed. |

The same LiveKit room can contain Windows and Linux clients.
This follows from the shared LiveKit connection and media APIs.
A test with an actual Windows publisher is still necessary.
[LiveKit connection documentation](https://docs.livekit.io/intro/basics/connect/).

## Screen Sharing

Screen sharing has two separate operations:

1. Capture video from a screen or window.
2. Send that video through LiveKit.

The LiveKit video operation passed on Linux.
The test used generated moving video instead of a real desktop capture.
The receiver displayed the expected image, and the video frames continued to change.
The test also passed with Electron set to use Wayland.

The real desktop test then passed with a source selected in the KDE dialog.
The receiver displayed H.264 video at 1280x614.
The test checked decoded frames, nonblank pixels, and advancing playback time.
Hide, watch again, and stop also passed.

The original screen selector requested a source list before sharing.
It requested another source list when sharing started.
It then looked for the previously selected source.

On KDE Wayland, a desktop portal gives the user a screen or window selection dialog.
PipeWire supplies the selected video stream.
Electron returns one selected source on this path.
That two-request design could cause repeated dialogs or an invalid source selection.
This risk comes from the code and documentation.
The research did not reproduce that failure with a real capture.
[Electron Linux capture documentation](https://www.electronjs.org/docs/latest/api/desktop-capturer#linux).

The new Wayland path requests selection once when sharing starts.
Opening the quality dialog does not request desktop sources.
The capture handler uses the source that the portal returns.
It rejects cancelled, empty, and old requests.
The automated tests check cancellation, retry, and late responses.
Windows keeps its source list.
The Linux X11 path also keeps that source list, but X11 is not the first release target.

Do not use `useSystemPicker: true` as a Linux fix.
Electron documents that option for macOS 15 and later.
Linux uses the desktop portal through the PipeWire capture path.
[Electron capture request documentation](https://www.electronjs.org/docs/latest/api/session#sessetdisplaymediarequesthandlerhandler-opts).

## Audio and Voice Chat

### Received Screen Audio

This is audio from a screen share that another person sends.
The Linux application receives the audio through LiveKit.
It does not need the Windows capture helper.
Keep this feature in the first Linux version.

### Outgoing System Audio

This is audio from applications on your computer.
For example, it can include a game's sound or a video's sound.

Zodiak currently uses `SystemAudioCapture.exe` to capture this audio.
The helper uses Windows Audio Session API (WASAPI) functions.
These functions do not have a direct Linux implementation.

Disabling **Exclude Discord** does not remove this dependency.
Every share with **System audio** enabled calls the Windows helper.
Both options are now disabled in the Linux interface.
The main process also rejects these options.
Screen video sharing stays enabled.

Later, add a Linux capture method based on PipeWire or PulseAudio.
Whole-system capture can also capture Zodiak's received audio.
This can cause repeated audio or feedback.
The Linux audio design must account for this behavior.
[PipeWire audio routing documentation](https://docs.pipewire.org/page_module_loopback.html).

### Voice Chat

Voice chat uses your microphone.
It does not use the Windows system-audio helper.
The existing microphone code uses LiveKit, WebRTC, and browser audio processing.
We kept that code.
The automated tests passed with generated audio and real WebRTC transport.

Check microphone access, input selection, mute, noise suppression, and received voice audio.
Do not claim that voice chat is fully tested yet.
The live video test did not capture a microphone.

## The Settings Path Problem

The problem is the storage location.
It is not a problem with Windows backslashes in a filename.
The code already uses `node:path.join()` to construct paths.

Before this change, `src/main/index.ts` selected a `data` folder beside the executable for every packaged application.
The rule now applies only to Windows.
Linux uses Electron's normal writable user folders.

The folder contains these files:

| File or folder | Purpose |
| --- | --- |
| `config.json` | Server address, API key, API secret, display name, and application settings. |
| `identity.json` | Your saved participant identity. |
| `participant-volumes.json` | Saved participant names and volume settings. |
| `session/` | Browser session data and cache. |
| `logs/` | Application logs. |
| `crash-dumps/` | Crash reports. |

The Windows installer puts the application in a user-selected folder.
That folder can allow the user to write application data.

An AppImage normally starts from a read-only mounted folder.
The application cannot save its data there.
A Linux package can install under `/opt` or `/usr`.
A normal user usually cannot write to those folders either.
An extracted AppImage can use a temporary folder, which is unsuitable for saved settings.

Linux now uses a writable folder in the user's home directory.
For example, the settings folder can be:

```text
/home/your-user/.config/zodiak/
  config.json
  identity.json
  participant-volumes.json
```

This is an example, not a fixed path.
The application uses Electron's `app.getPath('userData')` to get the actual settings folder.
It keeps Electron's normal folders for session data, logs, and crash reports.
The Windows storage rule is unchanged.

The directory and AppImage tests confirmed that settings, identity, and participant volumes remain after a restart.
Replacing an installed package still needs a separate test.
The JSON file formats do not need to change.

## Installer Options

Keep the current Windows installer for Windows users.
Its WPF interface, NSIS package, and PowerShell scripts are specific to the Windows release.
Changing the target name to Linux will not make that installer work on Linux.

Linux has these options:

| Option | What you get | Current result |
| --- | --- | --- |
| Start from source | Start the graphical application with a terminal command. | Startup and the Linux controls passed their tests. |
| Directory package | Application files and a Linux executable in one folder. | Build, startup, saved data, and restart passed. |
| AppImage | One downloadable application file. It does not provide the Windows installation wizard. | Build, extraction startup, saved data, and restart passed. |
| Arch package | A package that `pacman` can install and remove. | Build and metadata checks passed. System installation and removal are not tested. |

Some AppImage setups need FUSE support.
FUSE lets the system use the AppImage contents as a mounted folder.
The `fuse2` package was absent on this computer.
The `--appimage-extract-and-run` option passed on this computer.
Normal mounted startup with FUSE still needs a test.

The current electron-builder documentation marks its Arch package target as beta.
Check package installation and removal before release.
[Linux package documentation](https://www.electron.build/docs/linux/).

Linux packages now exclude `SystemAudioCapture.exe` and the Windows ICO resource.
The package configuration includes these resources only for Windows.

The Arch package tool needs `libcrypt.so.1` on the build computer.
Arch supplies it in `libxcrypt-compat`.
This is a build dependency, not an application dependency.
The local build used a signature-verified Arch library from a temporary folder.
It did not install or replace a system package.
[Arch package file list](https://archlinux.org/packages/core/x86_64/libxcrypt-compat/files/).

The release workflow now builds Linux packages after the Windows release job.
It adds the AppImage, archive, and Arch package to the same release.
This workflow has not run in GitHub Actions yet.
No release was published during these tests.

There is also a separate branch-build workflow in `.github/workflows/linux-branch.yml`.
Each push to `feat/linux` builds Linux packages without a release tag.
The packages are available in the Actions run for seven days.
This workflow does not create a release or change Windows update files.
See [branch-build instructions](run-from-source.md#linux-branch-builds).

Automatic updates need Linux release files such as `latest-linux.yml` and `beta-linux.yml`.
The current beta-release check expects the Windows file `beta.yml`.
Change that check before enabling automatic Linux updates.
[Update documentation](https://www.electron.build/docs/features/auto-update/).

## Results of the Tests

Tests used Arch Linux, KDE Wayland, Node 24.21.0, and npm 11.19.0.
The local test server used LiveKit 1.13.9.
The project documentation specifies Node 22.12 or later in the 22.x series.
Node 24 worked here, but the documented Node 22 version still needs a check.

| Test | Result |
| --- | --- |
| Install JavaScript dependencies | Passed. Startup did not need a .NET build. |
| Type checks and application build | Passed after the Linux changes. Large JavaScript file warnings remain. |
| Application startup | Passed. The interface, saved identity, and saved preferences passed their checks. |
| Linux startup | A hidden Wayland window could wait for its first paint. Linux now also starts after the page load and interface readiness checks. Source and package tests passed. |
| Received audio | Passed. The test checked playback, volume, mute, output selection, and cleanup. |
| Screen-share cleanup | Passed with simulated screen shares. This did not check desktop capture. |
| Linux capture handler | Passed with simulated portal results. Checked one request, cancellation, retry, late results, and unsupported audio. |
| Linux interface | Passed. Checked disabled controls, the quality dialog, sharing, retry, and the minimum window size. |
| Existing interface and updater tests | Passed. Windows behavior was checked with simulated Windows capabilities. An actual Windows build still needs a test. |
| Voice tests | Passed with generated microphone audio. Checked transmission, reception, gain, mute, noise processing, device changes, and cleanup. |
| LiveKit server operations | Passed. The test created a room, listed rooms, and listed its participants. |
| LiveKit video | Passed. Two clients joined. Video arrived with changing frames and the expected image. |
| Real KDE desktop capture | Passed with a source selected by the user. The receiver decoded H.264 at 1280x614. Hide, watch again, and stop passed. |
| Hide, watch again, and stop video | Passed with video sent through the local LiveKit server. |
| Directory and AppImage application | Passed. Real packaged applications loaded their preload and Linux capabilities. Saved data remained after two launches. |
| Arch package | Built. Checked the x86_64 architecture, dependency list, executable path, and application-menu entry. Installation is not tested. |
| Linux updater restriction | Passed. Linux does not check feeds, download updates, or start an installer through the Windows update path. |
| Text and image chat | Delivery passed. A later check for a recipient who left the room failed. |
| Video test without server settings | Failed with exit code 1, as expected. |

The live-chat test printed `Missing expected rejection`, but returned exit code 0.
Do not treat that test run as a complete pass.

The earlier startup test reported an update error for the test version, `0.0`.
The new Linux path does not create an automatic updater.
The updated startup test passed without that error.

The media tests also reported `vaInitialize failed`.
Software H.264 video processing worked despite this error.
Hardware video processing and high frame rates are not confirmed.

## Tests Still Necessary

- Check both a complete monitor and an application window.
- Cancel screen selection, then start a new share.
- Close a shared window, then check that capture stops.
- Watch and hear a screen share from an actual Windows client.
- Speak through a real microphone and hear another person's voice.
- Connect through the application's server settings and room interface.
- Check an internet connection, not only the local test server.
- Start the AppImage through a FUSE mount.
- Replace an installed package, then check the saved settings and identity.
- Install and remove the Arch package through `pacman`.
- Check video quality, frame rate, CPU use, and GPU use.

## Implemented Changes

1. Kept the connection, room, chat, voice, and received-media code.
2. Added supported-feature information to the preload and interface.
3. Disabled outgoing system audio and Discord exclusion on Linux.
4. Added main-process checks for unsupported audio options.
5. Added one portal request for Wayland screen selection.
6. Added capture cancellation and checks for late results.
7. Kept Linux packaged data in writable user folders.
8. Added Linux package commands and a Linux release job.
9. Disabled Linux automatic updates until a separate update implementation is tested.

Relevant code:

| File | Change |
| --- | --- |
| `src/main/index.ts` | Linux data paths and checks for unsupported share options. |
| `src/main/platform.ts` | Supported features and Wayland selection. |
| `src/main/capture.ts` | One screen-selection request on the Linux portal path. |
| `src/shared/types.ts` and `src/preload/index.ts` | Information about supported capture features. |
| `src/renderer/src/main.ts` and `src/renderer/index.html` | Linux share controls and screen selection. |
| `src/renderer/src/session.ts` | Keep received media and video publication. Use no outgoing system audio initially. |
| `package.json` and `.github/workflows/release.yml` | Linux package commands, resources, and release builds. |
| `src/main/updater.ts` | Disabled unsupported Linux update actions. The Windows feed code is unchanged. |

## Start the Current Application

Dependencies are already installed in this workspace.
From the project folder, use:

```bash
npm run dev
```

This command opens a graphical application.
Enter your LiveKit server address, API key, and API secret in **Server connection**.
For the first capture test, select 720p and 15 FPS.
Higher frame rates still need a test.

The command uses the Linux changes in this working tree.
The system-audio options are disabled automatically.
The graphical application also runs from the directory package:

```bash
./dist/linux-unpacked/zodiak
```

Build packages with `npm run pack:linux`.
Build an Arch installer package with `npm run pack:linux:arch`.
See [source and package instructions](run-from-source.md) for dependencies and installation commands.

## Repeat the Live Video Test

Use a separate local LiveKit server for this test.
Install the Linux server from the [official release](https://github.com/livekit/livekit/releases/tag/v1.13.9).
Start it in one terminal:

```bash
livekit-server --dev --bind 127.0.0.1
```

Start the test from the project folder in another terminal:

```bash
env LIVEKIT_URL=ws://127.0.0.1:7880 \
  LIVEKIT_API_KEY=devkey LIVEKIT_API_SECRET=secret \
  node_modules/.bin/electron tests/screen-share-live.cjs --ozone-platform=wayland
```

These credentials are public development defaults.
Do not use them for your production server.
The test creates a temporary room and removes it after the test.
It also uses temporary settings folders.
[LiveKit local server documentation](https://docs.livekit.io/transport/self-hosting/local/).

By default, the test uses generated video in place of desktop capture.
It checks the application connection code, room code, video sender, and video receiver.
It does not check the KDE screen-selection dialog.

To test real desktop capture, use the same local server and run:

```bash
env LIVEKIT_URL=ws://127.0.0.1:7880 \
  LIVEKIT_API_KEY=devkey LIVEKIT_API_SECRET=secret \
  npm run test:share:desktop
```

Select a screen or window in the KDE dialog.
The test uses the real capture handler and two visible test clients.
It saves its result in `release/ui-review/linux-desktop-test.json`.
The test stops after three minutes if you do not select a source.

## Technical Terms

| Term | Meaning in this document |
| --- | --- |
| Screen share | Video from a screen or window. Screen audio is a separate stream. |
| System audio | Sound from applications on your computer. This does not mean microphone voice. |
| Access token | A signed credential that lets a participant join a LiveKit room. |
| Desktop portal | A Linux service that requests permission and lets you select a screen or window. |
| PipeWire | A Linux system that supplies media streams and connects audio devices and applications. |
| H.264 | The video format that Zodiak currently sends. |
| WPF | A Microsoft interface framework used by the Windows installer. |
| NSIS | The tool that makes the current Windows installation package. |
| AppImage | A Linux application file that includes the application and its required files. |
| Packaged application | An application prepared for distribution, instead of started from its source files. |

This document uses short sentences and defined software terms.
Its writing reference is [ASD-STE100 Simplified Technical English](https://www.asd-ste100.org/about.html).
