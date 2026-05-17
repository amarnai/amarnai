# Genizor

Gmail-first AI email triage assistant.

## Prerequisites

- Node.js 20.6+
- pnpm (`npm install -g pnpm`)
- Docker (for local Postgres and Redis)

## Environment

There is a single `.env` at the monorepo root. All apps and database scripts read from it automatically — no per-package env files needed.

```bash
cp .env.example .env   # then fill in any secrets
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
