# Genizor

Gmail-first AI email triage assistant.

## Prerequisites

- Node.js 20+
- pnpm (`npm install -g pnpm`)

## Setup

```bash
pnpm install
```

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
