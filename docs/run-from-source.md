# Run from source

## Requirements

- 64-bit Windows.
- Node.js 22.12 or later, with npm.
- .NET 8 SDK (for the system-audio helper).
- A running [zodiak-api](https://github.com/1ukah/zodiak-api) and zodiak-media. See its README.

## Start Zodiak

Open PowerShell in the project folder and run:

```powershell
npm install
npm run build:system-audio-capture
npm run dev
```

Development builds connect to `http://127.0.0.1:8080`. To use another API, set `ZODIAK_API_URL` before `npm run dev`.
For an HTTPS development server, also set `ZODIAK_API_CA` to the path of the server's CA certificate.
Installed builds always connect to `https://zodiak.emono.host:20005` and trust only `resources/zodiak-ca.pem`.

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
| `npm run test:e2e` | Register, servers, text chat and logout against a running API on port 18080. |
| `npm run test:e2e:voice` | Voice and screen share between two app processes, against a running API and media server. |

## Build the installer

```powershell
npm run pack
```

This command builds the app and creates `dist/zodiak-setup.exe`. Put the server CA certificate at `build/zodiak-ca.pem` first.
