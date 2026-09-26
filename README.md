# Welfare Office

Windows screen sharing. Open the app to see rooms on the LiveKit server. Join a room, pick which screens to watch, and share your own. Several people can share in one room. Leaving a room does not delete it.

System audio can be shared with the screen. Audio from `Discord.exe` is left out. If Discord is not running, the share uses normal system audio.

## Build

Requires Go and 64-bit Windows.

```powershell
New-Item -ItemType Directory -Force -Path dist | Out-Null
go build -ldflags "-H windowsgui" -o "dist\Welfare Office.exe" ./cmd/welfare
```

Friends only need that file.

## Verification

Run the regular checks with:

```powershell
go test ./...
```

On a Windows desktop with the configured LiveKit server reachable, the native
capture, codec, audio, room-list, join, share, watch, and cleanup checks can
also be run end to end. The test creates and deletes its own temporary room.

```powershell
$env:WELFARE_NATIVE_TEST = '1'
$env:WELFARE_LIVEKIT_E2E = '1'
go test -count=1 ./internal/audio ./internal/capture ./internal/encode ./internal/session
```

The app opens with server `ws://179.90.226.218:7880`. API credentials are left blank and must be entered in Server settings. A saved copy is stored in `%AppData%\WelfareOffice\config.json`.

Do not distribute a real LiveKit API secret in the app or ask friends to enter
one they should not control. This client uses the configured credentials to
mint participant tokens and manage rooms. A public release needs a server-side
token broker with separate permissions for joining and room administration.

When sharing a monitor, the app window is hidden from the captured image on
Windows versions that support `WDA_EXCLUDEFROMCAPTURE`; the app reports when
Windows cannot apply that setting.

Windows may block the unsigned exe. Choose **More info**, then **Run anyway**.
