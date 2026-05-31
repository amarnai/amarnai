FROM node:22-alpine AS base
RUN corepack enable pnpm

# ── Install dependencies ───────────────────────────────────────────────────────
FROM base AS installer
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json     apps/web/
COPY apps/api/package.json     apps/api/
COPY apps/worker/package.json  apps/worker/
COPY packages/ai/package.json      packages/ai/
COPY packages/config/package.json  packages/config/
COPY packages/db/package.json      packages/db/
COPY packages/gmail/package.json   packages/gmail/
COPY packages/queue/package.json   packages/queue/
COPY packages/shared/package.json  packages/shared/
COPY packages/ui/package.json      packages/ui/
RUN pnpm install --frozen-lockfile

# ── Runtime ───────────────────────────────────────────────────────────────────
FROM installer AS runner
WORKDIR /repo
COPY . .
RUN pnpm --filter @amarnai/db generate
ENV NODE_ENV=production
WORKDIR /repo/apps/worker
CMD ["pnpm", "run", "start"]
