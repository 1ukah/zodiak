# Welfare Office

Windows screen sharing app. Anyone who opens it sees the rooms on the LiveKit server. Joining a room watches the screen being shared there. One person can share in a room. Leaving a room does not delete it.

System audio can be shared with the screen. Audio from `Discord.exe` is left out. If Discord is not running, the share uses normal system audio.

## Run from source

Requires Node.js and 64-bit Windows.

```powershell
npm install
npm run dev
```

`npm start` opens the production build. `npm run typecheck` checks TypeScript.

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
