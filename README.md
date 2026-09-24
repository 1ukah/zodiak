# Welfare Office

Cross-platform screen sharing app. Anyone who opens it sees the rooms on the LiveKit server. Joining a room watches the screen being shared there. One person can share in a room. Leaving a room does not delete it.

System audio can be shared with the screen. Audio from `Discord.exe` is left out on Windows. On macOS, audio from Discord is left out when its audio process is active. If Discord is not running, the share uses normal system audio.

## Run from source on Windows

Requires Node.js and 64-bit Windows. The Windows build keeps its portable executable and Windows audio helper.

```powershell
npm install
npm run dev
```

`npm start` opens the production build. `npm run typecheck` checks TypeScript.

## Run from source on macOS

Requires Node.js, macOS 14.2 or later, and Xcode Command Line Tools. The minimum macOS version is required for per-process system audio capture and Discord exclusion.

```sh
npm install
npm run build:mac-audio
npm run dev
```

macOS asks for Screen Recording permission when sharing a display or window and System Audio Recording permission when system audio sharing starts. The helper and app include the required privacy descriptions.

The app opens with server `ws://179.90.226.218:7880`, API key `devkey`, and API secret `secret`. Those defaults live in `src/main/config.ts`. A saved copy is stored in the Electron user data folder, not in this repo.

## System audio helper

System audio needs `native/bin/SystemAudioCapture.exe`. That file is compiled locally and is not committed. .NET Framework `csc` is included with Windows.

```powershell
New-Item -ItemType Directory -Force -Path native\bin
& "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /optimize+ /platform:x64 /target:winexe /r:System.Management.dll /out:native\bin\SystemAudioCapture.exe native\SystemAudioCapture.cs
```

## Shareable exe

```powershell
npm run pack
```

The file to send is `dist/Welfare Office.exe`. Friends only need that file. It is not committed. The first open unpacks into a temporary folder and removes it when the app closes.

Windows may block the unsigned exe. Choose **More info**, then **Run anyway**.

## macOS app and disk image

```sh
npm run pack:mac
```

This creates an Apple Silicon macOS app, a `.zip` containing its standalone `.app` bundle, and a `.dmg` in `dist`. The native audio helper is compiled locally for Apple Silicon and is not committed. These builds are unsigned; macOS may require Control-clicking the app and choosing **Open** the first time. The Windows `npm run pack` command continues to create `dist/Welfare Office.exe`.
