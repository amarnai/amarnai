# Amarnai

Gmail-first AI email triage assistant.

## Prerequisites

- Node.js 20.6+
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

Set the following in `.env` (or your deployment secrets):

```env
# LLM
AI_PROVIDER=frontier
FRONTIER_LLM_PROVIDER=openai
FRONTIER_LLM_API_KEY=<your key>
FRONTIER_LLM_MODEL=<model name>

# Embeddings (Gemini)
EMBEDDING_PROVIDER=gemini
GEMINI_EMBEDDING_API_KEY=<your Google AI Studio key>
GEMINI_EMBEDDING_MODEL=text-embedding-004
```

Get a Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey).

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
openssl rand -hex 32      # paste as GMAIL_TOKEN_ENCRYPTION_KEY
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

**Local development:**

Run `pnpm tunnel` in a separate terminal alongside `pnpm dev`. It starts a [Cloudflare quick tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) exposing your local API and automatically updates the Pub/Sub push endpoint:

```bash
pnpm tunnel
```

Requires [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) and `gcloud` on your PATH. Quick tunnel URLs are ephemeral — re-run `pnpm tunnel` each dev session (the script updates the push endpoint automatically each time).

**Google sign-in users:** inbox access is granted during sign-up as part of the same OAuth consent — no extra step needed.

**Email/password users:** after verifying your email, go to **Settings** in the sidebar and click **Connect Gmail**. Google will ask you to grant read-only access to the inbox you want to sort. Once connected, the workspace shows the linked Gmail address and last verification time.

**Required APIs** — enable these in your Google Cloud project:

- Gmail API (`gmail.googleapis.com`)

**Env vars:**

| Variable | Description |
|----------|-------------|
| `GMAIL_OAUTH_CALLBACK_URL` | Redirect URI registered in Google Cloud Console. Default: `http://localhost:3000/api/gmail/callback` |
| `GMAIL_TOKEN_ENCRYPTION_KEY` | 64-char hex string (32 bytes) used to AES-256-GCM-encrypt stored refresh tokens. Generate with `openssl rand -hex 32`. Falls back to a key derived from `AUTH_SECRET` when unset — always set this explicitly in production. |
| `GMAIL_PUBSUB_TOPIC` | Optional. Pub/Sub topic for real-time push notifications. Format: `projects/<project-id>/topics/<topic-name>`. See [Real-time sync](#real-time-sync-gmail-push-notifications). |
| `GMAIL_PUBSUB_WEBHOOK_SECRET` | Optional. Secret token verified on incoming Pub/Sub push requests. Generate with `openssl rand -hex 32`. Required when `GMAIL_PUBSUB_TOPIC` is set. |

**Google Cloud Console checklist for Gmail:**

1. APIs & Services → Library → enable **Gmail API**
2. APIs & Services → Credentials → open your OAuth client → add `http://localhost:3000/api/gmail/callback` to authorised redirect URIs (in production, add your production URL)

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
git clone https://github.com/amarnai/amarnai.git
cd amarnai

# 2. Create your env file from the self-host template
cp .env.selfhost.example .env

# 3. Fill in every value marked <required>:
#    AUTH_SECRET, AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET, INTERNAL_API_SECRET,
#    GMAIL_TOKEN_ENCRYPTION_KEY, FRONTIER_LLM_API_KEY, GEMINI_EMBEDDING_API_KEY,
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
#    AUTH_SECRET, AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET, INTERNAL_API_SECRET, GMAIL_TOKEN_ENCRYPTION_KEY
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

Starts all apps in parallel:

| App | URL |
|-----|-----|
| Web | http://localhost:3000 |
| API | http://localhost:3001 |
| Worker | — |

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
  web/      Next.js frontend
  api/      Hono API server
  worker/   Background jobs
packages/
  shared/   Shared types and constants
  config/   Environment config
  db/       Database schema and client
  ai/       AI provider abstraction
```
