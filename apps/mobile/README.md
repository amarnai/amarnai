# @aziru/mobile

Amarnai's Android app (Expo + Expo Router). Readonly triage companion.

## Test on a physical device (local dev)

1. Install the **Expo Go** app on your Android phone, and put the phone on the
   **same Wi-Fi** as your dev machine.

2. Start the backend from the repo root:

   ```bash
   pnpm dev    # api (3001) + worker + web, against your local DB
   ```

3. Start the app's Metro bundler:

   ```bash
   pnpm --filter @aziru/mobile start
   ```

4. Scan the QR code shown in the terminal with Expo Go.

The app figures out your dev machine's LAN IP from the Metro connection and points
the API at `http://<that-ip>:3001` automatically, so there is nothing to configure.
The home screen shows a connectivity indicator:

- **API OK** (green): the phone reached your local API.
- **API unreachable** (red): see troubleshooting below.

To override the API URL (tunnel, staging, prod), copy `.env.example` to `.env` and
set `EXPO_PUBLIC_API_URL`.

### Troubleshooting "API unreachable"

- Confirm `pnpm dev` is running and `curl http://localhost:3001/health` returns
  `{"ok":true}` on your dev machine.
- Phone and dev machine must be on the same network (some guest/AP-isolation
  networks block device-to-device traffic). If so, use a tunnel and set
  `EXPO_PUBLIC_API_URL`, or run `expo start --tunnel`.
- A local firewall may block inbound connections to port 3001; allow it.
