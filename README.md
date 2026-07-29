# Amarnai

Gmail-first AI email triage assistant, with read-only Outlook support in beta. Both connections are read-only: Amarnai sorts and labels your inbox but never sends or mutates mail, and drafts always require your approval.

## Prerequisites

- Node.js 24+ (see `.nvmrc` — run `nvm use`). The Lingui 6 i18n CLI requires Node 24.2 or newer.
- pnpm (`npm install -g pnpm`)
- Docker (for local Postgres and Redis)

## Environment

`.env` is the base env file at the monorepo root. All apps read from it automatically.  
`.env.local` is for local overrides and is never committed.

```bash
cp .env.example .env              # base config (fill in secrets)
cp .env.local.example .env.local  # local overrides (optional)
```

Values in `.env.local` take precedence over `.env`.


### Local Ollama testing

Amarnai can use an Ollama instance running on your machine.

```bash
# 1. Install Ollama if needed
# https://ollama.com/download

# 2. Start Ollama
ollama serve

# 3. Pull the local models
ollama pull qwen3:14b         # LLM (used at runtime)
ollama pull qwen3-embedding   # embeddings (used for sorting)

# 4. Copy local overrides
cp .env.local.example .env.local
````

Make sure `.env.local` contains:

```env
AI_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen3:14b
ENABLE_DEV_TOOLS=true
```

Check that Ollama is reachable:

```bash
curl http://localhost:11434/api/tags
```

If port `11434` is already in use, Ollama is probably already running. In that case, skip `ollama serve` and continue with `ollama pull qwen3:14b`.


### Production LLM + embeddings

The recommended production configuration is Gemini for both the LLM (via its OpenAI-compatible endpoint) and embeddings. Set the following in `.env` (or your deployment secrets):

```env
# LLM (Gemini, recommended)
AI_PROVIDER=frontier
FRONTIER_LLM_PROVIDER=gemini
FRONTIER_LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/
FRONTIER_LLM_MODEL=gemini-2.5-flash-lite
FRONTIER_LLM_API_KEY=<your Google AI Studio key>

# Optional: use a lighter model for routing and different models for drafts
# and taxonomy generation. Each falls back to FRONTIER_LLM_MODEL if unset.
ROUTING_LLM_MODEL=
DRAFT_LLM_MODEL=
TAXONOMY_LLM_MODEL=

# Embeddings (Gemini, recommended)
EMBEDDING_PROVIDER=frontier
FRONTIER_EMBEDDING_PROVIDER=gemini
FRONTIER_EMBEDDING_API_KEY=<your Google AI Studio key>
FRONTIER_EMBEDDING_MODEL=gemini-embedding-001
FRONTIER_EMBEDDING_DIMENSIONS=768
```

Get a Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey). OpenAI (or any OpenAI-compatible endpoint) is a supported alternative: set `FRONTIER_LLM_PROVIDER=openai` with `FRONTIER_LLM_MODEL=gpt-4o-mini`, and `FRONTIER_EMBEDDING_PROVIDER=openai` with `FRONTIER_EMBEDDING_MODEL=text-embedding-3-small` (or point `FRONTIER_EMBEDDING_BASE_URL` at a custom endpoint).

## Authentication setup

Amarnai supports two sign-in methods:

- **Google** — one-step signup: Google OAuth grants both app identity and `gmail.readonly` inbox access simultaneously. The default workspace is created and connected automatically.
- **Email + password** — sign up with any email address, verify it, then connect a Gmail inbox separately from Settings.

### Google OAuth credentials

Required for both Google sign-in and Gmail inbox connection:

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials
2. Create an OAuth 2.0 Client ID (Web application)
3. Add `http://localhost:3000` to authorised JavaScript origins
4. Add **both** of the following to authorised redirect URIs:
   - `http://localhost:3000/api/auth/callback/google` — NextAuth sign-in
   - `http://localhost:3000/api/gmail/callback` — Gmail inbox connection
5. Copy the client ID and secret into `.env`:

```env
AUTH_GOOGLE_ID=<your client id>
AUTH_GOOGLE_SECRET=<your client secret>
```

Also generate random secrets:

```bash
openssl rand -base64 32   # paste as AUTH_SECRET
openssl rand -hex 32      # paste as INTERNAL_API_SECRET
openssl rand -hex 32      # paste as TOKEN_ENCRYPTION_KEY
```

### Email auth (local dev)

Verification and password reset emails are captured by [Mailpit](https://mailpit.axllent.org/) — no real emails are sent. Start Mailpit with `docker compose up -d mailpit` and open the inbox at http://localhost:8025.

For production, configure an SMTP provider (e.g. AWS SES) via:

```env
EMAIL_FROM=noreply@yourdomain.com
SMTP_HOST=email-smtp.us-east-1.amazonaws.com
SMTP_PORT=587
SMTP_USER=<SES SMTP username>
SMTP_PASS=<SES SMTP password>
```

## Gmail inbox setup

Amarnai lets each workspace connect one Gmail inbox for email triage. The connection requests only `gmail.readonly` access — it cannot send or modify email.

### Real-time sync (Gmail Push Notifications)

By default, Amarnai polls Gmail every 5 minutes for new messages. To get near-zero latency — Gmail notifies Amarnai the instant a message arrives — enable Gmail Push Notifications via Google Cloud Pub/Sub.

**One-time GCP setup:**

```bash
# 1. Enable APIs
gcloud services enable gmail.googleapis.com pubsub.googleapis.com

# 2. Create a Pub/Sub topic
gcloud pubsub topics create amarnai-gmail-push

# 3. Grant the Gmail service account publish rights on the topic
gcloud pubsub topics add-iam-policy-binding amarnai-gmail-push \
  --member="serviceAccount:gmail-api-push@system.gserviceaccount.com" \
  --role="roles/pubsub.publisher"

# 4. Generate a webhook secret and note it — you'll set it as GMAIL_PUBSUB_WEBHOOK_SECRET
openssl rand -hex 32

# 5. Create a push subscription pointing at your API's webhook endpoint
gcloud pubsub subscriptions create amarnai-gmail-sub \
  --topic=amarnai-gmail-push \
  --push-endpoint="https://api.yourdomain.com/webhooks/gmail?token=<your-secret>" \
  --ack-deadline=30
```

**Set the env vars:**

```env
GMAIL_PUBSUB_TOPIC=projects/<project-id>/topics/amarnai-gmail-push
GMAIL_PUBSUB_WEBHOOK_SECRET=<your-secret>
```

When these are set, Amarnai automatically registers each connected inbox with Gmail's push API on connection and renews the registration daily (Gmail watches expire after 7 days). Polling continues as a fallback for any missed events.

**Notes:**
- The Pub/Sub push endpoint (`/webhooks/gmail`) must be reachable from the public internet — this is a Google → your server call.
- Self-hosters who prefer not to set up GCP can leave both vars unset and rely on polling.

**Local development:** `pnpm dev` starts a Cloudflare tunnel and points the dev Pub/Sub subscription at it. See [Real-time push in local dev](#real-time-push-in-local-dev).

**Google sign-in users:** inbox access is granted during sign-up as part of the same OAuth consent — no extra step needed.

**Email/password users:** after verifying your email, go to **Settings** in the sidebar and click **Connect Gmail**. Google will ask you to grant read-only access to the inbox you want to sort. Once connected, the workspace shows the linked Gmail address and last verification time.

**Required APIs** — enable these in your Google Cloud project:

- Gmail API (`gmail.googleapis.com`)

**Env vars:**

| Variable | Description |
|----------|-------------|
| `GMAIL_OAUTH_CALLBACK_URL` | Redirect URI registered in Google Cloud Console. Default: `http://localhost:3000/api/gmail/callback` |
| `TOKEN_ENCRYPTION_KEY` | 64-char hex string (32 bytes) used to AES-256-GCM-encrypt stored OAuth refresh tokens (Gmail and Outlook share it). Generate with `openssl rand -hex 32`. Required in production — there is no fallback, and startup fails without a valid 64-hex key. |
| `GMAIL_PUBSUB_TOPIC` | Optional. Pub/Sub topic for real-time push notifications. Format: `projects/<project-id>/topics/<topic-name>`. See [Real-time sync](#real-time-sync-gmail-push-notifications). |
| `GMAIL_PUBSUB_WEBHOOK_SECRET` | Optional. Secret token verified on incoming Pub/Sub push requests. Generate with `openssl rand -hex 32`. Required when `GMAIL_PUBSUB_TOPIC` is set. |

**Google Cloud Console checklist for Gmail:**

1. APIs & Services → Library → enable **Gmail API**
2. APIs & Services → Credentials → open your OAuth client → add `http://localhost:3000/api/gmail/callback` to authorised redirect URIs (in production, add your production URL)

## Outlook inbox setup (beta, read-only)

Amarnai supports Outlook read-only via Microsoft Graph, at feature parity with Gmail. It is opt-in: Gmail is the default provider, and Outlook only appears in the connect flow once you enable it.

1. In the [Microsoft Entra admin center](https://entra.microsoft.com/), register a **confidential Web app**.
2. For **Supported account types**, choose "Accounts in any organizational directory (multitenant) and personal Microsoft accounts". The tenant/authority is then the literal string `common`.
3. Add the redirect URI `http://localhost:3000/api/outlook/callback` (use your domain in production).
4. Add delegated **API permissions**: `Mail.Read`, `offline_access`, `User.Read`, `openid`. None require admin consent.
5. Create a client secret.

**Env vars:**

```env
# Add outlook to the providers offered in the connect flow
MAIL_PROVIDERS=gmail,outlook

# Setting CLIENT_ID + CLIENT_SECRET together enables the Outlook provider
MS_GRAPH_CLIENT_ID=<your app client id>
MS_GRAPH_CLIENT_SECRET=<your app client secret>
MS_GRAPH_TENANT=common
OUTLOOK_OAUTH_CALLBACK_URL=http://localhost:3000/api/outlook/callback

# Optional: real-time sync via Microsoft Graph change-notification subscriptions
# (the Outlook analogue of Gmail Pub/Sub). Leave unset for polling-only.
MS_GRAPH_NOTIFICATION_URL=https://api.yourdomain.com/webhooks/outlook
MS_GRAPH_SUBSCRIPTION_SECRET=<openssl rand -hex 32>
```

The runtime adapter is always chosen per connection, so a single deployment can serve Gmail and Outlook inboxes at once. When `MS_GRAPH_NOTIFICATION_URL` is unset or not HTTPS, Outlook runs polling-only on `INBOX_SYNC_INTERVAL_MS`.

For real-time Outlook sync on a dev machine, see [Real-time push in local dev](#real-time-push-in-local-dev). It needs a stable HTTPS hostname, so `localhost` will not work.

## Dev seed account

Running `pnpm db:seed` creates a local dev user and workspace:

| Field | Value |
|-------|-------|
| Email | `dev@amarnai.local` |
| Name | Amarnai Dev User |
| Workspace | Default Workspace |

This seed user is attached to the mock taxonomy and sample email threads used for local testing and AI sorting tests. It is **not** created in production signups.

## Self-hosting

Amarnai can be self-hosted on any machine with Docker and Docker Compose. All services (web, API, worker, Postgres, Redis) start with a single command.

### Prerequisites

- Docker 24+ with the Compose plugin (`docker compose version`)
- A Google Cloud project with OAuth 2.0 credentials (see [Authentication setup](#authentication-setup))
- An AI API key — OpenAI, any OpenAI-compatible provider, or Gemini for embeddings

### Setup

```bash
# 1. Clone the repo
git clone https://github.com/BenAzlay/amarnai.git
cd amarnai

# 2. Create your env file from the self-host template
cp .env.selfhost.example .env

# 3. Fill in every value marked <required>:
#    AUTH_SECRET, AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET, INTERNAL_API_SECRET,
#    TOKEN_ENCRYPTION_KEY, FRONTIER_LLM_API_KEY, FRONTIER_EMBEDDING_API_KEY,
#    SMTP_HOST / SMTP_USER / SMTP_PASS, EMAIL_FROM
#    Update AUTH_URL, CORS_ORIGIN, and GMAIL_OAUTH_CALLBACK_URL to your domain.

# 4. Build images and start all services
#    First boot runs database migrations automatically before the API starts.
docker compose -f docker-compose.selfhost.yml up -d --build
```

The web UI is available at `http://localhost:3000` (or your configured domain).

| Service | Default port |
|---------|-------------|
| Web     | 3000        |
| API     | 3001        |
| Postgres | internal   |
| Redis    | internal   |

Postgres and Redis are not exposed externally by default. If you need direct access (e.g. for backups), add `ports` entries to `docker-compose.selfhost.yml`.

### Upgrading

```bash
git pull
docker compose -f docker-compose.selfhost.yml up -d --build
```

Migrations run automatically on each deploy via the `migrate` service.

### Reverse proxy

For production HTTPS, put Nginx or Caddy in front and proxy port 3000. Example Caddyfile:

```
mail.yourdomain.com {
    reverse_proxy localhost:3000
}
```

Update `AUTH_URL`, `CORS_ORIGIN`, and `GMAIL_OAUTH_CALLBACK_URL` in `.env` to match your domain, then re-run `docker compose -f docker-compose.selfhost.yml up -d`.

## Local development

```bash
# 1. Copy environment config
cp .env.example .env

# 2. Fill in secrets (see Authentication setup above):
#    AUTH_SECRET, AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET, INTERNAL_API_SECRET, TOKEN_ENCRYPTION_KEY
#    SMTP vars default to Mailpit (127.0.0.1:1025) — no changes needed for local email auth

# 3. Start Postgres, Redis, and Mailpit
docker compose up -d postgres redis mailpit

# 4. Install dependencies
pnpm install

# 5. Generate Prisma client
pnpm db:generate

# 6. Run database migrations
pnpm db:migrate

# 7. Seed the database
pnpm db:seed

# 8. Start all apps
pnpm dev
```

### Real-time push in local dev

Both providers push to a webhook on the API (port 3001), which has to be reachable from the public internet. `pnpm dev` starts a [Cloudflare tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) alongside the API for exactly that, so real-time sync works locally without a second terminal. It needs [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) on your PATH, plus `gcloud` for Gmail. When something is not configured the tunnel is skipped with a one-line notice and the rest of `pnpm dev` starts normally, falling back to polling.

**Recommended: a named tunnel (Gmail + Outlook).** Set `DEV_TUNNEL_HOSTNAME` to a hostname on a Cloudflare-hosted domain you own, one per developer. One-time setup:

```bash
cloudflared tunnel login
cloudflared tunnel create dev-yourname
cloudflared tunnel route dns dev-yourname dev-yourname.yourdomain.com
```

Then in `.env.local`:

```env
DEV_TUNNEL_HOSTNAME=dev-yourname.yourdomain.com
MS_GRAPH_NOTIFICATION_URL=https://dev-yourname.yourdomain.com/webhooks/outlook
```

The tunnel name defaults to the first label of the hostname; override with `DEV_TUNNEL_NAME`. On startup the script checks that `MS_GRAPH_NOTIFICATION_URL` matches the tunnel and prints the correct value if it does not.

**Why Outlook needs the stable hostname:** Graph bakes the notification URL into each subscription when it is created and its update operation only accepts a new expiry, so the URL cannot be repointed. A hostname that survives across dev sessions lets subscriptions keep working on their own ~70h renewal cycle. The worker registers a subscription for every active Outlook connection on startup, so restart it after setting the URL.

**Fallback: a quick tunnel (Gmail only).** Leave `DEV_TUNNEL_HOSTNAME` unset and the script uses an ephemeral `*.trycloudflare.com` URL, rewriting the Pub/Sub push endpoint on every run. No Cloudflare account or domain needed. Outlook push stays inert, since Graph cannot follow a URL that changes each session.

Run the tunnel on its own (or to see the full error when setup is incomplete):

```bash
pnpm tunnel
```

Start `pnpm dev` without it:

```bash
DEV_TUNNEL=0 pnpm dev
```

**Notes for teams:** the tunnel only ever touches the `amarnai-gmail-sub-dev` subscription (override with `GMAIL_PUBSUB_SUBSCRIPTION`), never the production one, and it rewrites the endpoint only when it differs. Since each developer has a distinct hostname and a shared GCP project has one dev subscription, whoever started `pnpm dev` last receives the Gmail notifications. Graph subscriptions are per-mailbox, so Outlook has no such contention. `cloudflared` logs each incoming request URL, which includes `GMAIL_PUBSUB_WEBHOOK_SECRET` as a query token, so treat dev console output as sensitive or use a dev-only secret.

### Database scripts

| Script | Description |
|--------|-------------|
| `pnpm db:generate` | Generate Prisma client from schema |
| `pnpm db:migrate` | Run pending migrations (dev) |
| `pnpm db:seed` | Seed the database |
| `pnpm db:reset` | Drop, re-migrate, and re-seed (dev only) |

## Development

```bash
pnpm dev
```

Starts the core runtime apps in parallel:

| App | URL |
|-----|-----|
| Web | http://localhost:3000 |
| API | http://localhost:3001 |
| Worker | (no HTTP surface) |

The marketing site (`apps/site`, port 3002), docs site (`apps/docs`, port 3003),
and browser extension are not part of `pnpm dev`. Run them on demand with
`pnpm --filter @amarnai/site dev`, `pnpm --filter @amarnai/docs dev`, and the
`pnpm extension:*` scripts respectively.

## Browser extension

`apps/extension` is the Amarnai browser side-panel extension (Manifest V3),
available for Chrome and Firefox. It holds a live SSE connection to the API and
mirrors the web app's triage surface in a side panel. It is built with Vite and
kept out of `pnpm dev`.

```bash
pnpm extension:build            # Chrome (dev build) -> apps/extension/dist
pnpm extension:build:firefox    # Firefox (dev build) -> apps/extension/dist-firefox
pnpm extension:package          # production Chrome .zip for the Web Store
pnpm extension:package:firefox  # production Firefox .zip for AMO
```

Load the unpacked `dist/` (Chrome) or `dist-firefox/` (Firefox) directory in your
browser's extension developer mode. See [`apps/extension/README.md`](apps/extension/README.md)
for the full build, configuration, and store-deployment guide.

## Mobile app

> **Shelved/paused.** The mobile app is on hold (see the Cross-Platform Parity
> section in [CLAUDE.md](CLAUDE.md)). The code stays in the repo, but it is not
> updated for every feature or UI change. Web and the browser extension are the
> active clients.

`apps/mobile` is the Amarnai Android app (Expo + Expo Router), a readonly triage
companion. It is intentionally kept out of `pnpm dev` so web/API/worker
contributors aren't forced into the React Native toolchain.

To run it on a **physical phone** (recommended) or an emulator with Expo Go:

```bash
# 1. Install the Expo Go app on your Android phone, on the SAME Wi-Fi as your
#    dev machine. (Or have an Android emulator running.)

# 2. Start the backend (api on 3001 + worker + web) in one terminal:
pnpm dev

# 3. Start the app's Metro bundler in another terminal:
pnpm mobile

# 4. Scan the QR code shown in the terminal with Expo Go.
```

The app auto-detects your dev machine's LAN IP from the Metro connection and
points the API at `http://<that-ip>:3001`, so there is nothing to configure. The
home screen shows a connectivity indicator (green **API OK** when the phone
reaches your local API). To override the API URL, set `EXPO_PUBLIC_API_URL` (see
`apps/mobile/.env.example`).

See [`apps/mobile/README.md`](apps/mobile/README.md) for troubleshooting and notes
on push notifications (which require a development build rather than Expo Go).

## Other commands

```bash
pnpm typecheck   # type-check all packages
pnpm lint        # lint all packages
pnpm test        # run tests
```

## Testing

### Running tests

```bash
pnpm test                  # all packages
pnpm test:sorting          # AI sorting tests only (fast, no DB)
```

### AI embedding fixtures

The embedding sorter tests in `packages/ai` use pre-computed vectors stored in
`packages/ai/src/__tests__/fixtures/embedding-vectors.json`. These are real
`qwen3-embedding` embeddings (committed to the repo) so the test suite runs
offline without Ollama and stays deterministic in CI.

**When to regenerate:** if you change a taxonomy node's name or description, add
new test emails to `sorting-fixtures.ts`, or switch the embedding model.

**How to regenerate:**

```bash
# Requires Ollama running locally with qwen3-embedding
ollama pull qwen3-embedding

pnpm --filter @amarnai/ai seed:embeddings
```

This calls Ollama once, embeds all taxonomy nodes and test email threads, and
overwrites `embedding-vectors.json`. Commit the updated file alongside your
taxonomy or fixture changes.

To use a different Ollama base URL or model:

```bash
OLLAMA_BASE_URL=http://my-host:11434 OLLAMA_EMBEDDING_MODEL=qwen3-embedding:0.6b \
  pnpm --filter @amarnai/ai seed:embeddings
```

### Fine-tuning sorter constants

The sorter uses several numeric thresholds (`THETA_MIN`, `CROSS_BRANCH_MARGIN`, etc.). A grid-search benchmark sweeps 4,096 constant combinations against the labeled fixtures and ranks them by score:

```bash
# Requires embedding-vectors.json to be current (run seed:embeddings first)
pnpm --filter @amarnai/ai benchmark:constants
```

The output shows the top-ranked configurations with a per-email breakdown and a recommendation. If a configuration beats the current defaults, update the constants at the top of `packages/ai/src/embedding/sorter.ts`. Re-run `pnpm test` afterwards to confirm no regressions.

## Structure

```
apps/
  web/        Next.js frontend (builds with --webpack)
  api/        Hono API server (the only DB writer)
  worker/     Background jobs (BullMQ)
  site/       Marketing site (Next.js, Cloudflare via OpenNext)
  extension/  Browser side-panel extension (Chrome + Firefox, MV3)
  docs/       Documentation site (Fumadocs)
  mobile/     Expo Android app (shelved/paused)
packages/
  db/         Database schema, migrations, and client
  ai/         AI provider abstraction, embedding sorter, drafts
  mail/       Provider-neutral mail seam (MailProvider interface)
  gmail/      Gmail provider (read-only) + token encryption
  outlook/    Outlook provider over Microsoft Graph (read-only)
  auth/       Credentials, JWT/Bearer, connection guards
  billing/    Stripe subscriptions and cleanup
  email/      Transactional email (Resend or SMTP)
  core/       Framework-free view-model logic
  ui/         Shared React components + email templates
  tokens/     Framework-agnostic design tokens and theme
  i18n/       Lingui catalogs (16 locales)
  api-client/ Transport-agnostic typed API client
  queue/      BullMQ job definitions
  shared/     Shared types and Zod schemas
  config/     Environment config
```

## License

Copyright (C) 2026 Azgard LLC

Amarnai is free software licensed under the GNU Affero General Public License v3.0 (AGPL-3.0-only). See [LICENSE](LICENSE) for the full text.

Contributions are accepted under a Contributor License Agreement — see [CLA.md](CLA.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

## Trademarks

Gmail™ is a trademark of Google LLC. Outlook™ is a trademark of the Microsoft group of companies. Amarnai is an independent project, not affiliated with or endorsed by Google or Microsoft.
