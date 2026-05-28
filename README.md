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
ollama pull llama3.1:8b       # LLM (used at runtime)
ollama pull qwen3-embedding   # embeddings (used for sorting)

# 4. Copy local overrides
cp .env.local.example .env.local
````

Make sure `.env.local` contains:

```env
AI_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.1:8b
ENABLE_DEV_TOOLS=true
```

Check that Ollama is reachable:

```bash
curl http://localhost:11434/api/tags
```

If port `11434` is already in use, Ollama is probably already running. In that case, skip `ollama serve` and continue with `ollama pull llama3.1:8b`.


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

**Google sign-in users:** inbox access is granted during sign-up as part of the same OAuth consent — no extra step needed.

**Email/password users:** after verifying your email, go to **Settings** in the sidebar and click **Connect Gmail**. Google will ask you to grant read-only access to the inbox you want to sort. Once connected, the workspace shows the linked Gmail address and last verification time.

**Required APIs** — enable these in your Google Cloud project:

- Gmail API (`gmail.googleapis.com`)

**Env vars:**

| Variable | Description |
|----------|-------------|
| `GMAIL_OAUTH_CALLBACK_URL` | Redirect URI registered in Google Cloud Console. Default: `http://localhost:3000/api/gmail/callback` |
| `GMAIL_TOKEN_ENCRYPTION_KEY` | 64-char hex string (32 bytes) used to AES-256-GCM-encrypt stored refresh tokens. Generate with `openssl rand -hex 32`. Falls back to a key derived from `AUTH_SECRET` when unset — always set this explicitly in production. |

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
