import { z } from 'zod';

const boolStr = z.string().transform((v) => v === 'true').default('false');

// A 32-byte AES key encoded as exactly 64 hexadecimal characters.
const TOKEN_ENCRYPTION_KEY_RE = /^[0-9a-fA-F]{64}$/;

// Fixed dev/test-only token-encryption key. Only ever reached outside
// production (validateEnv throws before `config` is built when a real key is
// missing in production), so it can never protect real user tokens. The
// obvious "c0de" pattern makes it recognisable as a placeholder in logs/dumps.
const DEV_TOKEN_ENCRYPTION_KEY = 'a3f1c0de'.repeat(8);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  API_PORT: z.string().default('3001'),
  WORKER_PORT: z.string().default('3002'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  // Optional dedicated Redis for the best-effort AI cache (embedding vectors,
  // dedup memos). Point this at a separate instance in production so the cache
  // can never evict BullMQ queue/job data under memory pressure — separate
  // logical DBs do NOT help, since maxmemory and eviction are instance-wide.
  // When unset, the cache shares REDIS_URL; see ai-dedup.ts for the eviction
  // guidance that applies in that shared case.
  AI_CACHE_REDIS_URL: z.string().optional(),
  INBOX_SYNC_INTERVAL_MS: z.string().default('300000'), // 5 minutes
  AI_PROVIDER: z.enum(['mock', 'ollama', 'frontier']).default('mock'),
  ENABLE_DEV_TOOLS: boolStr,
  FRONTIER_LLM_PROVIDER: z.string().optional(),
  FRONTIER_LLM_API_KEY: z.string().optional(),
  FRONTIER_LLM_MODEL: z.string().optional(),
  FRONTIER_LLM_BASE_URL: z.string().optional(),
  OLLAMA_BASE_URL: z.string().optional(),
  OLLAMA_MODEL: z.string().optional(),
  EMBEDDING_PROVIDER: z.enum(['mock', 'ollama', 'frontier']).default('mock'),
  OLLAMA_EMBEDDING_MODEL: z.string().optional(),
  FRONTIER_EMBEDDING_PROVIDER: z.string().optional(),
  FRONTIER_EMBEDDING_API_KEY: z.string().optional(),
  FRONTIER_EMBEDDING_MODEL: z.string().optional(),
  FRONTIER_EMBEDDING_BASE_URL: z.string().optional(),
  // Output vector size (Matryoshka truncation for gemini-embedding-001, or the
  // `dimensions` param for OpenAI text-embedding-3). Recommended: 768. Omit to
  // use the model default (3072 for gemini-embedding-001). Folded into the
  // stored embeddingModel identity, so changing it re-embeds all vectors.
  FRONTIER_EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().optional(),
  ALLOW_LOCAL_AI_IN_PRODUCTION: boolStr,
  // Set to 'false' to disable per-workspace monthly draft quotas.
  // Self-hosted deployments that manage their own AI costs should set this to false.
  ENFORCE_DRAFT_QUOTA: z.string().transform((v) => v !== 'false').default('true'),
  // Set to 'false' to disable per-workspace monthly thread-sort quotas.
  // Self-hosted deployments that manage their own AI costs should set this to false.
  ENFORCE_THREAD_SORT_QUOTA: z.string().transform((v) => v !== 'false').default('true'),
  // Set to 'false' to disable the per-inbox backfill cap (pooled, with the grace
  // re-import). Self-hosted deployments managing their own AI costs may turn this
  // off to backfill unbounded history. Usage is still recorded for observability.
  ENFORCE_BACKFILL_QUOTA: z.string().transform((v) => v !== 'false').default('true'),
  // Set to 'false' to unlock plan-level backfill caps WITHOUT a first Stripe payment.
  // Cloud keeps this on so FREE/trialing inboxes backfill at the FREE cap until they
  // pay. Stripe-less self-hosts are unaffected in practice: ENFORCE_BACKFILL_QUOTA=false
  // bypasses the pooled ceiling (and this gate) entirely, and the migration grandfathers
  // every existing non-FREE workspace (firstPaidAt = now()). Installs that assign a paid
  // plan by hand later should set this to 'false' (or set Workspace.firstPaidAt).
  ENFORCE_BACKFILL_PAYMENT_GATE: z.string().transform((v) => v !== 'false').default('true'),
  // Set to 'false' to disable the per-inbox monthly taxonomy-generation backstop.
  // Self-hosted deployments managing their own AI costs should set this to false.
  ENFORCE_TAXONOMY_QUOTA: z.string().transform((v) => v !== 'false').default('true'),
  INTERNAL_API_SECRET: z.string().optional(),
  // Secret for signing per-user access tokens (mobile + future native clients).
  // Distinct from INTERNAL_API_SECRET (service-to-service) and AUTH_SECRET
  // (next-auth web session). Generate with: openssl rand -hex 32
  AUTH_JWT_SECRET: z.string().optional(),
  // AES-256-GCM key used to encrypt stored OAuth refresh tokens at rest, for
  // EVERY provider (Gmail and Outlook share one key). 64 hex chars = 32 bytes.
  // Generate with: openssl rand -hex 32. Required in production; there is NO
  // fallback — a missing/invalid key fails startup (see validateEnv) rather than
  // encrypting under a source-derivable default. Outside production a fixed
  // dev-only default is used so local dev/tests work unconfigured; that default
  // is unreachable in production because the gate below throws first.
  TOKEN_ENCRYPTION_KEY: z.string().optional(),
  // Set to 'true' to turn off per-IP rate limiting on the /auth/* endpoints.
  // Intended only for self-host setups that throttle at the proxy layer.
  AUTH_RATE_LIMIT_DISABLED: boolStr,
  // Number of trusted reverse proxies in front of the API. Controls how the
  // client IP is derived for rate limiting: 0 ignores X-Forwarded-For / X-Real-IP
  // entirely and uses the socket address, so a direct caller cannot spoof an
  // arbitrary IP to dodge the limit. Set to the exact number of hops you run (e.g.
  // 1 behind a single nginx, 2 behind a CDN + nginx) so the real client is read
  // from the correct XFF position and everything to its left (attacker-controlled)
  // is ignored.
  //
  // Left OPTIONAL (not defaulted) so production can distinguish "unset" from an
  // explicit 0: the validateEnv gate below refuses to start in production when it
  // is unset, because a silent 0 behind a load balancer makes every user share one
  // rate-limit bucket (aggregate /auth traffic then throttles everyone out of
  // login). Non-production resolves an unset value to 0 (see config below).
  //
  // An empty string (TRUST_PROXY=, a common compose/k8s state) must count as
  // UNSET, not 0: bare `z.coerce.number().optional()` would run Number('') = 0 and
  // silently pass the production gate. The preprocess maps '' -> undefined so the
  // gate treats missing and empty identically.
  TRUST_PROXY: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.coerce.number().int().min(0).optional(),
  ),
  // Gmail Push Notifications via Google Cloud Pub/Sub.
  // When set, Gmail pushes change notifications in real time instead of waiting
  // for the polling interval. Both vars must be set together.
  // Format: "projects/<project-id>/topics/<topic-name>"
  GMAIL_PUBSUB_TOPIC: z.string().optional(),
  // Random secret included as ?token= in the Pub/Sub push subscription URL.
  // Generate with: openssl rand -hex 32
  GMAIL_PUBSUB_WEBHOOK_SECRET: z.string().optional(),
  // ─── Microsoft Graph (Outlook) OAuth + push ─────────────────────────────────
  // Confidential Web app registration (multitenant + personal accounts). CLIENT_ID
  // and CLIENT_SECRET must be set together to enable the Outlook provider. TENANT
  // is the literal "common" for the multitenant+personal account type.
  MS_GRAPH_CLIENT_ID: z.string().optional(),
  MS_GRAPH_CLIENT_SECRET: z.string().optional(),
  MS_GRAPH_TENANT: z.string().default('common'),
  // clientState secret echoed on every Graph change-notification so the webhook
  // can verify a subscription callback is genuinely ours. Generate: openssl rand -hex 32
  MS_GRAPH_SUBSCRIPTION_SECRET: z.string().optional(),
  // Public HTTPS URL Graph posts change notifications to (the notificationUrl of
  // each subscription). Analogous to GMAIL_PUBSUB_TOPIC: when unset, Outlook runs
  // polling-only. Must be publicly reachable so Graph's validation handshake and
  // subsequent notifications succeed. e.g. https://api.amarnai.com/webhooks/outlook
  MS_GRAPH_NOTIFICATION_URL: z.string().optional(),
  // Which mail providers the product offers for connection, comma-separated.
  // Gates the UI/connect flows only; the runtime adapter is always chosen per
  // connection row. Defaults to gmail-only until Outlook launches.
  MAIL_PROVIDERS: z
    .string()
    .default('gmail')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    ),
  // Folder→label writeback (Gmail labels / Outlook categories). A single switch
  // for both providers: provider availability is already gated by MAIL_PROVIDERS
  // + credentials. When enabled, the write scope is requested UPFRONT at
  // sign-in/connect and writeback defaults ON per workspace (switch-off
  // available; without the scope it is inert). Off by default at the deployment
  // level — keep off in prod until Google's gmail.modify verification clears.
  LABEL_WRITEBACK_ENABLED: boolStr,
});

function validateEnv(raw: NodeJS.ProcessEnv) {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid environment variables:\n${result.error.message}`);
  }
  const env = result.data;

  if (env.AI_PROVIDER === 'ollama') {
    if (!env.OLLAMA_BASE_URL) throw new Error('OLLAMA_BASE_URL is required when AI_PROVIDER=ollama');
    if (!env.OLLAMA_MODEL) throw new Error('OLLAMA_MODEL is required when AI_PROVIDER=ollama');
    if (env.NODE_ENV === 'production' && !env.ALLOW_LOCAL_AI_IN_PRODUCTION) {
      throw new Error('AI_PROVIDER=ollama is not allowed in production unless ALLOW_LOCAL_AI_IN_PRODUCTION=true');
    }
  }

  // Skip runtime-secret validation during `next build` — INTERNAL_API_SECRET
  // and AUTH_JWT_SECRET are injected at container startup, not during the image
  // build. NEXT_PHASE is set to 'phase-production-build' by Next.js during the
  // build step and is absent at runtime, so this check is still enforced when
  // the server actually starts.
  const isBuildPhase = process.env.NEXT_PHASE === 'phase-production-build';

  if (env.NODE_ENV === 'production' && !isBuildPhase && !env.INTERNAL_API_SECRET) {
    throw new Error('INTERNAL_API_SECRET is required in production');
  }

  if (env.NODE_ENV === 'production' && !isBuildPhase && !env.AUTH_JWT_SECRET) {
    throw new Error('AUTH_JWT_SECRET is required in production');
  }

  // Force an explicit proxy topology in production. Proxy presence cannot be
  // safely auto-detected (the only signal, X-Forwarded-For, is attacker-
  // controlled), so the operator must state it: set TRUST_PROXY to the number of
  // reverse proxies in front of the app, or 0 for direct socket connections.
  // Skipped during the web build (secrets/topology are injected at runtime) and
  // outside production (unset resolves to 0).
  if (env.NODE_ENV === 'production' && !isBuildPhase && env.TRUST_PROXY === undefined) {
    throw new Error(
      'TRUST_PROXY is required in production: set it to the number of reverse proxies in ' +
        'front of the app (e.g. 1 behind nginx, 2 behind a CDN + nginx), or 0 if clients ' +
        'connect directly. An unset value behind a load balancer makes all users share one ' +
        'rate-limit bucket, throttling everyone out of login.',
    );
  }

  // Fail closed on the token-encryption key: refuse to start in production
  // unless a real 64-hex key is configured. Never fall back to a derived or
  // default key — that would encrypt every provider refresh token under a
  // source-derivable constant.
  if (
    env.NODE_ENV === 'production' &&
    !isBuildPhase &&
    !TOKEN_ENCRYPTION_KEY_RE.test(env.TOKEN_ENCRYPTION_KEY ?? '')
  ) {
    throw new Error(
      'TOKEN_ENCRYPTION_KEY is required in production and must be 64 hex characters (generate with: openssl rand -hex 32)',
    );
  }

  if (env.GMAIL_PUBSUB_TOPIC && !env.GMAIL_PUBSUB_WEBHOOK_SECRET) {
    throw new Error('GMAIL_PUBSUB_WEBHOOK_SECRET is required when GMAIL_PUBSUB_TOPIC is set');
  }

  // Outlook is enabled by a full confidential-client credential pair. Require both
  // together so a half-configured registration fails fast instead of at connect time.
  if (env.MS_GRAPH_CLIENT_ID && !env.MS_GRAPH_CLIENT_SECRET) {
    throw new Error('MS_GRAPH_CLIENT_SECRET is required when MS_GRAPH_CLIENT_ID is set');
  }
  if (env.MS_GRAPH_CLIENT_SECRET && !env.MS_GRAPH_CLIENT_ID) {
    throw new Error('MS_GRAPH_CLIENT_ID is required when MS_GRAPH_CLIENT_SECRET is set');
  }

  // Graph change-notification push requires both the public callback URL and the
  // clientState secret the webhook verifies. Mirror Gmail's TOPIC→SECRET pairing.
  if (env.MS_GRAPH_NOTIFICATION_URL && !env.MS_GRAPH_SUBSCRIPTION_SECRET) {
    throw new Error(
      'MS_GRAPH_SUBSCRIPTION_SECRET is required when MS_GRAPH_NOTIFICATION_URL is set',
    );
  }

  if (env.AI_PROVIDER === 'frontier') {
    if (!env.FRONTIER_LLM_PROVIDER) throw new Error('FRONTIER_LLM_PROVIDER is required when AI_PROVIDER=frontier');
    if (!env.FRONTIER_LLM_API_KEY) throw new Error('FRONTIER_LLM_API_KEY is required when AI_PROVIDER=frontier');
    if (!env.FRONTIER_LLM_MODEL) throw new Error('FRONTIER_LLM_MODEL is required when AI_PROVIDER=frontier');
  }

  if (env.EMBEDDING_PROVIDER === 'ollama') {
    if (!env.OLLAMA_BASE_URL) throw new Error('OLLAMA_BASE_URL is required when EMBEDDING_PROVIDER=ollama');
    if (!env.OLLAMA_EMBEDDING_MODEL) throw new Error('OLLAMA_EMBEDDING_MODEL is required when EMBEDDING_PROVIDER=ollama');
    if (env.NODE_ENV === 'production' && !env.ALLOW_LOCAL_AI_IN_PRODUCTION) {
      throw new Error('EMBEDDING_PROVIDER=ollama is not allowed in production unless ALLOW_LOCAL_AI_IN_PRODUCTION=true');
    }
  }

  if (env.EMBEDDING_PROVIDER === 'frontier') {
    if (!env.FRONTIER_EMBEDDING_API_KEY) throw new Error('FRONTIER_EMBEDDING_API_KEY is required when EMBEDDING_PROVIDER=frontier');
    if (!env.FRONTIER_EMBEDDING_MODEL) throw new Error('FRONTIER_EMBEDDING_MODEL is required when EMBEDDING_PROVIDER=frontier');
  }

  return env;
}

const env = validateEnv(process.env);

export const config = {
  api: {
    port: Number(env.API_PORT),
  },
  worker: {
    port: Number(env.WORKER_PORT),
    inboxSyncIntervalMs: Number(env.INBOX_SYNC_INTERVAL_MS),
  },
  redis: {
    url: env.REDIS_URL,
    // Dedicated AI-cache instance when set; otherwise the cache shares `url`.
    aiCacheUrl: env.AI_CACHE_REDIS_URL,
  },
  ai: {
    provider: env.AI_PROVIDER,
    enableDevTools: env.ENABLE_DEV_TOOLS,
    allowLocalAiInProduction: env.ALLOW_LOCAL_AI_IN_PRODUCTION,
    frontier: {
      provider: env.FRONTIER_LLM_PROVIDER,
      apiKey: env.FRONTIER_LLM_API_KEY,
      model: env.FRONTIER_LLM_MODEL,
      baseUrl: env.FRONTIER_LLM_BASE_URL,
    },
    ollama: {
      baseUrl: env.OLLAMA_BASE_URL,
      model: env.OLLAMA_MODEL,
    },
  },
  embedding: {
    provider: env.EMBEDDING_PROVIDER,
    ollama: {
      baseUrl: env.OLLAMA_BASE_URL,
      model: env.OLLAMA_EMBEDDING_MODEL,
    },
    frontier: {
      provider: env.FRONTIER_EMBEDDING_PROVIDER,
      apiKey: env.FRONTIER_EMBEDDING_API_KEY,
      model: env.FRONTIER_EMBEDDING_MODEL,
      baseUrl: env.FRONTIER_EMBEDDING_BASE_URL,
      dimensions: env.FRONTIER_EMBEDDING_DIMENSIONS,
    },
  },
  billing: {
    enforceDraftQuota: env.ENFORCE_DRAFT_QUOTA,
    enforceThreadSortQuota: env.ENFORCE_THREAD_SORT_QUOTA,
    enforceBackfillQuota: env.ENFORCE_BACKFILL_QUOTA,
    enforceBackfillPaymentGate: env.ENFORCE_BACKFILL_PAYMENT_GATE,
    enforceTaxonomyQuota: env.ENFORCE_TAXONOMY_QUOTA,
  },
  internalApiSecret: env.INTERNAL_API_SECRET ?? 'dev-internal-secret',
  authJwtSecret: env.AUTH_JWT_SECRET ?? 'dev-auth-jwt-secret',
  // 64-hex AES-256-GCM key for stored OAuth refresh tokens (all providers). In
  // production validateEnv guarantees a real key was supplied; the dev default
  // is only reachable outside production.
  // `||` (not `??`) so a blank `TOKEN_ENCRYPTION_KEY=` in a .env file falls back
  // to the dev default outside production; in production an empty value is
  // already rejected by the validateEnv gate above.
  tokenEncryptionKey: env.TOKEN_ENCRYPTION_KEY || DEV_TOKEN_ENCRYPTION_KEY,
  authRateLimit: {
    disabled: env.AUTH_RATE_LIMIT_DISABLED,
    // Unset resolves to 0 here; production can never reach this with an unset
    // value (the validateEnv gate above throws first).
    trustProxy: env.TRUST_PROXY ?? 0,
  },
  gmail: {
    pubsubTopic: env.GMAIL_PUBSUB_TOPIC,
    webhookSecret: env.GMAIL_PUBSUB_WEBHOOK_SECRET,
  },
  outlook: {
    clientId: env.MS_GRAPH_CLIENT_ID,
    clientSecret: env.MS_GRAPH_CLIENT_SECRET,
    tenant: env.MS_GRAPH_TENANT,
    subscriptionSecret: env.MS_GRAPH_SUBSCRIPTION_SECRET,
    notificationUrl: env.MS_GRAPH_NOTIFICATION_URL,
    // Whether a full confidential-client credential pair is configured.
    enabled: Boolean(env.MS_GRAPH_CLIENT_ID && env.MS_GRAPH_CLIENT_SECRET),
  },
  mail: {
    // Providers offered in the UI/connect flows (runtime adapter is per-connection).
    enabledProviders: env.MAIL_PROVIDERS,
    // Master switch for opt-in folder→label writeback (both providers).
    labelWritebackEnabled: env.LABEL_WRITEBACK_ENABLED,
  },
};
