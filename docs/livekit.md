# Run a LiveKit server

Keep LiveKit running while you use Zodiak.

## Start the server

1. Download the Windows server from [LiveKit releases](https://github.com/livekit/livekit/releases/latest) and extract it.
2. Open PowerShell in that folder. Generate an API key and secret:

   ```powershell
   .\livekit-server.exe generate-keys
   ```

3. Create `livekit.yaml` in the same folder. Replace `YOUR_API_KEY` and `YOUR_API_SECRET` with the generated values:

   ```yaml
   port: 7880
   rtc:
     tcp_port: 7881
     udp_port: 7882
     use_external_ip: false
   keys:
     YOUR_API_KEY: YOUR_API_SECRET
   ```

4. Start the server:

   ```powershell
   .\livekit-server.exe --config livekit.yaml --bind 0.0.0.0
   ```

## Network access

Allow these ports through the server firewall:

| Port | Protocol | Use |
| --- | --- | --- |
| 7880 | TCP | Server connection |
| 7881 | TCP | Audio and video when UDP is unavailable |
| 7882 | UDP | Audio and video |

This configuration uses one UDP port. See the [LiveKit port reference](https://docs.livekit.io/transport/self-hosting/ports-firewall/).

For LAN use, keep `use_external_ip: false`. Port forwarding is not necessary.

For internet use, set `use_external_ip: true` and restart LiveKit. On your router, forward the three ports above to the server's LAN IP address. Use the same external and internal port numbers. The router must have a public IP address.

## Connect Zodiak

Open **Server connection**. Enter the API key and secret from `livekit.yaml`. Use the server URL for your connection:

- Same computer: `ws://127.0.0.1:7880`
- LAN: `ws://SERVER_LAN_IP:7880`
- Internet: `ws://SERVER_PUBLIC_IP:7880`

Replace the IP placeholders with the server addresses. Save the settings.
