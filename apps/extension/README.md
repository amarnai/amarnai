# @amarnai/extension

An MV3 **side panel** (Chrome) / **sidebar** (Firefox) that shows Amarnai's triage
next to Gmail.com: a live sorted-thread view with triage actions (mark done,
approve/reroute, sort-now), draft generation with copy-to-clipboard, and
click-to-open a thread in Gmail. No Gmail UI injection and no content scripts —
the panel is a client of the Amarnai API, exactly like the web and mobile apps.

The same panel code runs on both browsers. Divergence is isolated to four small
points: the manifest (`manifest.config.ts`), a tiny extension-API shim
(`src/platform/ext.ts` — `browser ?? chrome`), one branch in the background
script, and a runtime host-permission gate (`src/platform/permissions.ts`).

## Architecture

- **Panel page** (`index.html` + `src/`): the whole UI. It owns the SSE
  connection to the API (fetch + `Authorization` header + `ReadableStream` —
  `EventSource` cannot send auth headers). Extension pages bypass CORS via
  `host_permissions`, so no API CORS change is needed.
- **Background script** (`src/background/service-worker.ts`): intentionally tiny
  (MV3 service worker on Chrome, event page on Firefox). Both browsers suspend it
  when idle and streaming fetches don't keep it alive, so it holds no state — it
  only wires the toolbar icon to open the panel (Chrome: `sidePanel` behavior;
  Firefox: `action.onClicked` → `sidebarAction.toggle()`).
- **Host-permission gate** (`src/platform/permissions.ts`): Firefox treats MV3
  `host_permissions` as user-grantable and does not auto-grant them on temporary
  loads, so the sign-in handlers call `ensureHostPermissions()` (which prompts)
  before signing in, and `HostPermissionGate` offers a re-grant to an already
  signed-in session that is missing them. On Chrome the permissions are granted at
  install, so both resolve without a prompt — a no-op there.
- Auth mirrors mobile: per-user JWT via `makeBearerTransport` (`@amarnai/api-client`),
  tokens in `storage.local`, transparent refresh-on-401.

## Build

```sh
# Chrome → dist/
pnpm extension:build        # local build (development mode, reads .env)
pnpm extension:build:prod   # store build (production mode, reads .env.production)

# Firefox → dist-firefox/ (same env files; sets EXT_BROWSER=firefox)
pnpm extension:build:firefox
pnpm extension:build:prod:firefox
```

Each produces its output dir with `index.html`, `service-worker.js`,
`manifest.json`, and icons — Chrome in `dist/`, Firefox in `dist-firefox/`, so the
two never overwrite each other. `manifest.json` is **generated** at build time
from the environment (see `manifest.config.ts`): `host_permissions` is derived
from `VITE_API_URL` and `version` from `package.json`, and the `EXT_BROWSER` flag
selects the Chrome shape (`side_panel` + service worker + optional `"key"`) or the
Firefox shape (`sidebar_action` + event page + `browser_specific_settings.gecko`).
The top-level `"key"` (from `EXTENSION_KEY`) is Chrome-only and injected **only for
non-production builds**: it pins a stable ID for unpacked loads, but the Chrome
Web Store rejects any package that contains `"key"` (it re-signs and assigns the
canonical ID itself), so a `build:prod` / store package always omits it. The mode
selects the env file, so a local build never picks up prod values (and vice versa).

**Load in Chrome:** `chrome://extensions` → Developer mode → **Load unpacked** →
select `apps/extension/dist`.

**Load in Firefox:** `about:debugging#/runtime/this-firefox` → **Load Temporary
Add-on…** → select `apps/extension/dist-firefox/manifest.json`. Temporary loads
may not auto-grant host permissions; either approve them in the add-on's
Permissions tab in `about:addons`, or just click **Sign in** — the panel prompts
for them as part of sign-in.

For the stores: run the matching `:prod` build, then zip the output dir:

```sh
pnpm extension:package          # Chrome → amarnai-extension.zip
pnpm extension:package:firefox  # Firefox → amarnai-extension-firefox.zip
```

Upload the Chrome zip to the Chrome Web Store and the Firefox zip to
addons.mozilla.org (AMO). The AMO submission requires a data-collection
disclosure, and the `gecko.id` in the manifest is permanent — it must match the
listing forever.

`pnpm --filter @amarnai/extension dev` (or `dev:firefox`) runs a watch build
(rebuild + reload the unpacked extension; there is no HMR — an accepted trade-off
of the plain-Vite, no-framework setup).

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
- `EXTENSION_KEY` — *(optional, Chrome non-production builds only)* base64 DER
  public key that pins a stable extension ID for unpacked loads; injected as the
  manifest's top-level `"key"`. Production/store builds omit it (the Web Store
  rejects `"key"` and assigns the canonical ID by re-signing). Firefox ignores it
  — its stable ID comes from `gecko.id`. See below.

## Deployment prerequisites (Google sign-in)

The panel signs in with Google via `identity.launchWebAuthFlow`. The redirect URI
differs per browser, and the API redeems the resulting code against whichever URI
was used (`/auth/google` with `redirectUri` — it accepts any URL and Google
validates it against the client's registered URIs, so **no API change** is needed
for Firefox):

- Chrome: `https://<extension-id>.chromiumapp.org/`
- Firefox: `https://<hash-of-gecko-id>.extensions.allizom.org/`

### Chrome

1. **Pin the extension ID.** Chrome derives the ID from a public key. To get a
   stable ID (dev and prod), generate a key once and take its public half:
   ```sh
   openssl genrsa 2048 > key.pem                       # keep private, gitignored
   openssl rsa -in key.pem -pubout -outform DER | openssl base64 -A
   ```
   Put that base64 string in `EXTENSION_KEY` (in `.env`); non-production builds
   inject it as the manifest's top-level `"key"`. `key.pem` is gitignored and
   must never be committed. With `EXTENSION_KEY` unset (a fresh checkout), the
   manifest omits `key` and Chrome assigns a per-machine ID.

   Note: a production/store package never contains `"key"` (the Web Store rejects
   it and re-signs to assign the canonical ID). To make your unpacked dev builds
   share the store's ID (and one OAuth redirect), publish first, read the
   store-assigned ID, then set `EXTENSION_KEY` in `.env` to the key that matches
   it — dev and side-loaded builds then resolve to the same ID as the listing.
2. **Register the redirect URI.** In Google Cloud Console, add
   `https://<extension-id>.chromiumapp.org/` to the authorized redirect URIs of
   the Web OAuth client used by `AUTH_GOOGLE_ID`.

### Firefox

Firefox has no `EXTENSION_KEY` equivalent: the ID is fixed in the manifest as
`browser_specific_settings.gecko.id` (`amarnai@amarnai.com` — an identifier, not a
real mailbox; the domain just needs to be one you control). That id is permanent
and determines the redirect hash, so the redirect URI is stable for dev and store
builds alike.

1. **Get the redirect URI.** Load `dist-firefox/` and log
   `ext.identity.getRedirectURL()` once in the panel/background console. It returns
   `https://<hash>.extensions.allizom.org/`.
2. **Register it.** In Google Cloud Console, add that URI as an **additional**
   authorized redirect URI on the **same** Web OAuth client used for Chrome
   (`AUTH_GOOGLE_ID` / `VITE_GOOGLE_WEB_CLIENT_ID`). No separate client is needed.
