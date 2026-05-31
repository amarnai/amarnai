FROM node:22-alpine AS base
RUN corepack enable pnpm

# ── Install dependencies (cached until any package.json changes) ──────────────
FROM base AS deps
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

# ── Build ─────────────────────────────────────────────────────────────────────
FROM deps AS builder
WORKDIR /repo
COPY . .
RUN pnpm --filter @amarnai/db generate
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_ENABLE_GMAIL_DEBUG_TOOLS=false
RUN pnpm --filter @amarnai/web build

# ── Runtime ───────────────────────────────────────────────────────────────────
# next build --output standalone produces a self-contained server.js.
# No pnpm or node_modules copy needed — the traced deps are bundled inside.
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=builder /repo/apps/web/.next/standalone ./
COPY --from=builder /repo/apps/web/.next/static     ./apps/web/.next/static
EXPOSE 3000
ENV HOSTNAME=0.0.0.0
CMD ["node", "apps/web/server.js"]
