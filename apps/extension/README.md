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
pnpm extension:build        # local build (development mode, reads .env)
pnpm extension:build:prod   # store build (production mode, reads .env.production)
```

Both produce `dist/` with `index.html`, `service-worker.js`, `manifest.json`, and
icons. `manifest.json` is **generated** at build time from the environment (see
`manifest.config.ts`) — `host_permissions` is derived from `VITE_API_URL`,
`version` from `package.json`, and the top-level `"key"` from `EXTENSION_KEY`, so
there is no static manifest to hand-edit. The mode selects the env file, so a
local build never picks up prod values (and vice versa). Load `dist/` via
`chrome://extensions` → Developer mode → **Load unpacked** → select
`apps/extension/dist`.

For the store: run `pnpm extension:build:prod`, then zip the `dist/` contents
(`cd apps/extension/dist && zip -r ../amarnai-extension.zip .`) and upload the zip.

`pnpm --filter @amarnai/extension dev` runs a watch build (rebuild + reload the
unpacked extension; there is no HMR — an accepted trade-off of the plain-Vite,
no-framework setup).

## Configuration

Copy `.env.example` to `.env` for dev/watch. `vite build` defaults to production
mode, so a store build reads `.env.production`. Set:

- `VITE_API_URL` — API origin. The manifest's `host_permissions` is derived from
  this at build time, so it can never drift (a missing origin CORS-blocks the
  panel's fetches/SSE). Use an `https://` origin for a store build — Chrome
  rejects `http://` host permissions.
- `VITE_WEB_APP_URL` — web app origin (sign-up + connect-Gmail links out).
- `VITE_GOOGLE_WEB_CLIENT_ID` — the Google OAuth **Web** client id, for the
  "Sign in with Google" button.
- `EXTENSION_KEY` — *(optional, prod only)* base64 DER public key that pins a
  stable extension ID; injected as the manifest's top-level `"key"`. See below.

## Deployment prerequisites (Google sign-in)

The panel signs in with Google via `chrome.identity.launchWebAuthFlow`, whose
redirect is `https://<extension-id>.chromiumapp.org/`. The API redeems the
resulting code against that redirect (`/auth/google` with `redirectUri`).

1. **Pin the extension ID.** Chrome derives the ID from a public key. To get a
   stable ID (dev and prod), generate a key once and take its public half:
   ```sh
   openssl genrsa 2048 > key.pem                       # keep private, gitignored
   openssl rsa -in key.pem -pubout -outform DER | openssl base64 -A
   ```
   Put that base64 string in `EXTENSION_KEY` (in `.env` / `.env.production`); the
   build injects it as the manifest's top-level `"key"`. `key.pem` is gitignored
   and must never be committed. With `EXTENSION_KEY` unset (a fresh checkout), the
   manifest omits `key` and Chrome assigns a per-machine ID.

   Note: when you publish to the Chrome Web Store, the store re-signs the package
   and assigns the canonical ID for the listing — set `EXTENSION_KEY` to the key
   that matches that published ID so dev, side-loaded, and store builds share one
   ID (and one OAuth redirect).
2. **Register the redirect URI.** In Google Cloud Console, add
   `https://<extension-id>.chromiumapp.org/` to the authorized redirect URIs of
   the Web OAuth client used by `AUTH_GOOGLE_ID`.
