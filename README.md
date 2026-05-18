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

```bash
# 1. Copy local overrides (sets AI_PROVIDER=ollama)
cp .env.local.example .env.local

# 2. Start Ollama via Docker
docker compose --profile local-ai up -d ollama

# 3. Pull the model
docker exec -it $(docker compose ps -q ollama) ollama pull llama3.1:8b

# 4. Confirm AI_PROVIDER=ollama is set in .env.local
```

### Production frontier LLM

Set the following in `.env` (or your deployment secrets):

```
AI_PROVIDER=frontier
FRONTIER_LLM_PROVIDER=openai
FRONTIER_LLM_API_KEY=<your key>
FRONTIER_LLM_MODEL=<model name>
```

## Local development

```bash
# 1. Copy environment config
cp .env.example .env

# 2. Start Postgres and Redis
docker compose up -d postgres redis

# 3. Install dependencies
pnpm install

# 4. Generate Prisma client
pnpm db:generate

# 5. Run database migrations
pnpm db:migrate

# 6. Seed the database
pnpm db:seed

# 7. Start all apps
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
