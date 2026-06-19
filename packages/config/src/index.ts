import { z } from 'zod';

const boolStr = z.string().transform((v) => v === 'true').default('false');

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
  INTERNAL_API_SECRET: z.string().optional(),
  // Secret for signing per-user access tokens (mobile + future native clients).
  // Distinct from INTERNAL_API_SECRET (service-to-service) and AUTH_SECRET
  // (next-auth web session). Generate with: openssl rand -hex 32
  AUTH_JWT_SECRET: z.string().optional(),
  // Set to 'true' to turn off per-IP rate limiting on the /auth/* endpoints.
  // Intended only for self-host setups that throttle at the proxy layer.
  AUTH_RATE_LIMIT_DISABLED: boolStr,
  // When 'true', self-serve sign-up is closed (invite-only / waitlist). Read by
  // the API /auth/register endpoint so the signup policy matches the web app.
  WAITLIST_MODE: boolStr,
  // Gmail Push Notifications via Google Cloud Pub/Sub.
  // When set, Gmail pushes change notifications in real time instead of waiting
  // for the polling interval. Both vars must be set together.
  // Format: "projects/<project-id>/topics/<topic-name>"
  GMAIL_PUBSUB_TOPIC: z.string().optional(),
  // Random secret included as ?token= in the Pub/Sub push subscription URL.
  // Generate with: openssl rand -hex 32
  GMAIL_PUBSUB_WEBHOOK_SECRET: z.string().optional(),
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

  if (env.NODE_ENV === 'production' && !env.INTERNAL_API_SECRET) {
    throw new Error('INTERNAL_API_SECRET is required in production');
  }

  if (env.NODE_ENV === 'production' && !env.AUTH_JWT_SECRET) {
    throw new Error('AUTH_JWT_SECRET is required in production');
  }

  if (env.GMAIL_PUBSUB_TOPIC && !env.GMAIL_PUBSUB_WEBHOOK_SECRET) {
    throw new Error('GMAIL_PUBSUB_WEBHOOK_SECRET is required when GMAIL_PUBSUB_TOPIC is set');
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
  },
  internalApiSecret: env.INTERNAL_API_SECRET ?? 'dev-internal-secret',
  authJwtSecret: env.AUTH_JWT_SECRET ?? 'dev-auth-jwt-secret',
  authRateLimit: {
    disabled: env.AUTH_RATE_LIMIT_DISABLED,
  },
  waitlistMode: env.WAITLIST_MODE,
  gmail: {
    pubsubTopic: env.GMAIL_PUBSUB_TOPIC,
    webhookSecret: env.GMAIL_PUBSUB_WEBHOOK_SECRET,
  },
};
