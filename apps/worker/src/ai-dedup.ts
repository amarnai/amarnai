import { config } from "@amarnai/config";
import { createRedisSingleton } from "./redis-singleton.js";

// Retry de-duplication memo for paid AI calls.
//
// A `classify-thread` job runs with attempts: 3. Paid AI calls (e.g. the thread
// embedding) happen before the steps that most often fail, so a retry would
// re-pay for work the previous attempt already completed. This module memoizes
// a derived value (an embedding vector, a validated decision) under a key tied
// to the BullMQ jobId, so the same job reads it back instead of re-paying.
//
// Fails OPEN: any Redis error falls through to recomputing. A dead Redis must
// never crash a job — it only forfeits the cost saving.
//
// Stores only derived values (vectors/decisions), never email bodies, subjects,
// or prompts.

// Lazily-created singleton connection, kept separate from BullMQ's command
// connection. This is a best-effort cache on a job's critical path, so it must
// fail fast, not block. Unlike BullMQ/pub-sub connections we do NOT use
// maxRetriesPerRequest: null — that, with the default offline queue, would park
// a command indefinitely while Redis is down and hang the job instead of
// falling open. enableOfflineQueue: false rejects immediately when
// disconnected, and commandTimeout bounds a slow-but-connected server. All such
// errors land in the try/catch around get/set and trigger recompute.
const cache = createRedisSingleton(config.redis.url, "ai-dedup", {
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
  commandTimeout: 1_000,
});

export async function closeAiDedup(): Promise<void> {
  await cache.close();
}

// Long enough to outlast a full 3-attempt retry window (exponential backoff plus
// up to lockDuration 300s per attempt), short enough that stale derived vectors
// expire promptly. The single tunable in this module.
const TTL_SECONDS = 900;

/**
 * Build a workspace-scoped dedup key tied to the BullMQ jobId, a step name, and
 * the model identity. Returns null when jobId is undefined (BullMQ job.id is
 * `string | undefined`) so callers skip caching and just compute.
 */
export function buildDedupKey(
  workspaceId: string,
  jobId: string | undefined,
  step: string,
  model: string,
): string | null {
  if (!jobId) return null;
  return `aidedup:${workspaceId}:${jobId}:${step}:${model}`;
}

export type MemoCodec<T> = {
  compute: () => Promise<T>;
  serialize: (value: T) => string;
  /** Parse + validate a cached string. Return null to treat it as a miss. */
  deserialize: (raw: string) => T | null;
  /**
   * Whether a freshly computed value is worth storing. Defaults to always.
   * Use it to avoid memoizing failure sentinels (e.g. an empty vector), which
   * would otherwise return as a "hit" and suppress a real retry.
   */
  shouldCache?: (value: T) => boolean;
};

/**
 * Memoize a derived value across BullMQ retries of the same job.
 *
 * Read errors, write errors, and a null key all fall back to computing — the
 * computed result is always returned regardless of Redis health.
 */
export async function memoizeAcrossRetries<T>(
  key: string | null,
  codec: MemoCodec<T>,
): Promise<T> {
  if (key === null) return codec.compute();

  try {
    const cached = await cache.get().get(key);
    if (cached !== null) {
      const decoded = codec.deserialize(cached);
      if (decoded !== null) return decoded;
    }
  } catch (err) {
    console.error("[ai-dedup] Read failed, recomputing:", (err as Error).message);
  }

  const value = await codec.compute();

  if (codec.shouldCache === undefined || codec.shouldCache(value)) {
    try {
      await cache.get().set(key, codec.serialize(value), "EX", TTL_SECONDS);
    } catch (err) {
      console.error("[ai-dedup] Write failed, ignoring:", (err as Error).message);
    }
  }

  return value;
}

/**
 * Read-side validator for a cached embedding vector: a non-empty finite-number
 * array. Returns null on any parse or shape failure — including an empty array —
 * so the caller recomputes. Rejecting [] keeps the read side symmetric with the
 * shouldCache write guard, which never stores an empty (failed-embed) vector.
 */
export function parseVector(raw: string): number[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null;
  if (!parsed.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  return parsed as number[];
}
