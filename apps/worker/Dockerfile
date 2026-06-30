FROM node:24-alpine AS base
RUN corepack enable pnpm

# ── Install dependencies ───────────────────────────────────────────────────────
FROM base AS installer
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json     apps/web/
COPY apps/api/package.json     apps/api/
COPY apps/worker/package.json  apps/worker/
COPY packages/ai/package.json         packages/ai/
COPY packages/api-client/package.json packages/api-client/
COPY packages/auth/package.json       packages/auth/
COPY packages/config/package.json     packages/config/
COPY packages/core/package.json       packages/core/
COPY packages/db/package.json         packages/db/
COPY packages/email/package.json      packages/email/
COPY packages/gmail/package.json      packages/gmail/
COPY packages/i18n/package.json       packages/i18n/
COPY packages/queue/package.json      packages/queue/
COPY packages/shared/package.json     packages/shared/
COPY packages/tokens/package.json     packages/tokens/
COPY packages/ui/package.json         packages/ui/
RUN pnpm install --frozen-lockfile

# ── Runtime ───────────────────────────────────────────────────────────────────
FROM installer AS runner
WORKDIR /repo
COPY . .
RUN pnpm --filter @amarnai/db generate
# Compile Lingui catalogs (.po -> .mjs). The .mjs are gitignored and loaded at
# runtime by loadCatalog() (e.g. generate-taxonomy localizing per workspace locale).
RUN pnpm --filter @amarnai/i18n compile
ENV NODE_ENV=production
WORKDIR /repo/apps/worker
CMD ["pnpm", "run", "start"]
