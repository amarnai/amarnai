# Genizor

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

Genizor can use an Ollama instance running on your machine.

```bash
# 1. Install Ollama if needed
# https://ollama.com/download

# 2. Start Ollama
ollama serve

# 3. Pull the local test model
ollama pull llama3.1:8b

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


### Production frontier LLM

Set the following in `.env` (or your deployment secrets):

```
AI_PROVIDER=frontier
FRONTIER_LLM_PROVIDER=openai
FRONTIER_LLM_API_KEY=<your key>
FRONTIER_LLM_MODEL=<model name>
```

## Authentication setup

Genizor uses Google Sign-In for app identity. Before running locally, create OAuth credentials:

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

## Gmail inbox setup

Genizor lets each workspace connect one Gmail inbox for email triage. This is a separate OAuth flow from sign-in and requests only `gmail.readonly` access — it cannot read, send, or modify email.

After signing in, go to **Settings** in the sidebar and click **Connect Gmail**. Google will ask you to grant read-only access to the inbox you want to sort. Once connected, the workspace shows the linked Gmail address and last verification time.

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
| Email | `dev@genizor.local` |
| Name | Genizor Dev User |
| Workspace | Default Workspace |

This seed user is attached to the mock taxonomy and sample email threads used for local testing and AI sorting tests. It is **not** created in production signups.

## Local development

```bash
# 1. Copy environment config
cp .env.example .env

# 2. Fill in secrets (see Authentication setup above):
#    AUTH_SECRET, AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET, INTERNAL_API_SECRET, GMAIL_TOKEN_ENCRYPTION_KEY

# 3. Start Postgres and Redis
docker compose up -d postgres redis

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
