# @amarnai/extension

A Chrome MV3 **side panel** that shows Amarnai's triage next to Gmail.com: a live
sorted-thread view with triage actions (mark done, approve/reroute, sort-now),
draft generation with copy-to-clipboard, and click-to-open a thread in Gmail. No
Gmail UI injection and no content scripts — the panel is a client of the Amarnai
API, exactly like the web and mobile apps.

## Architecture

- **Panel page** (`index.html` + `src/`): the whole UI. It owns the SSE
  connection to the API (fetch + `Authorization` header + `ReadableStream` —
  `EventSource` cannot send auth headers). Extension pages bypass CORS via
  `host_permissions`, so no API CORS change is needed.
- **Service worker** (`src/background/service-worker.ts`): intentionally tiny.
  MV3 workers are killed ~30s after idle and streaming fetches don't keep them
  alive, so it holds no state — it only wires the toolbar icon to open the panel.
- Auth mirrors mobile: per-user JWT via `makeBearerTransport` (`@amarnai/api-client`),
  tokens in `chrome.storage.local`, transparent refresh-on-401.

## Build

```sh
pnpm --filter @amarnai/extension build
```

Produces `dist/` with `index.html`, `service-worker.js`, `manifest.json`, and
icons. Load it via `chrome://extensions` → Developer mode → **Load unpacked** →
select `apps/extension/dist`.

`pnpm --filter @amarnai/extension dev` runs a watch build (rebuild + reload the
unpacked extension; there is no HMR — an accepted trade-off of the plain-Vite,
no-framework setup).

## Configuration

Copy `.env.example` to `.env.development` / `.env.production` and set:

- `VITE_API_URL` — API origin. **Must** also be listed in
  `manifest.json` `host_permissions`, or the panel's fetches/SSE are CORS-blocked.
- `VITE_WEB_APP_URL` — web app origin (sign-up + connect-Gmail links out).
- `VITE_GOOGLE_WEB_CLIENT_ID` — the Google OAuth **Web** client id, for the
  "Sign in with Google" button.

## Deployment prerequisites (Google sign-in)

The panel signs in with Google via `chrome.identity.launchWebAuthFlow`, whose
redirect is `https://<extension-id>.chromiumapp.org/`. The API redeems the
resulting code against that redirect (`/auth/google` with `redirectUri`).

1. **Pin the extension ID.** Chrome derives the ID from a public key. To get a
   stable ID (dev and prod), generate a key once and add its public half to the
   manifest as a top-level `"key"` field:
   ```sh
   openssl genrsa 2048 > key.pem                       # keep private, gitignored
   openssl rsa -in key.pem -pubout -outform DER | openssl base64 -A
   ```
   Add `"key": "<that base64 string>"` to `manifest.json` locally. `key.pem` is
   gitignored and must never be committed. (The committed manifest omits `key`,
   so a fresh checkout gets a per-machine ID until you add one.)
2. **Register the redirect URI.** In Google Cloud Console, add
   `https://<extension-id>.chromiumapp.org/` to the authorized redirect URIs of
   the Web OAuth client used by `AUTH_GOOGLE_ID`.
