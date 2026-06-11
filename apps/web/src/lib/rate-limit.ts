// In-memory sliding-window rate limiter. Counts are per server instance and
// reset on restart, which is acceptable for low-stakes abuse protection (a
// determined attacker gets a few extra attempts per replica, not a bypass).
// If a shared limit across replicas ever becomes necessary, move the buckets
// to Redis (REDIS_URL is already provisioned for the worker queues).

const buckets = new Map<string, number[]>();
const MAX_KEYS = 10_000;

/** Records an attempt for `key` and returns true if it exceeded the limit. */
export function isRateLimited(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now()
): boolean {
  // Bound memory under abuse: when the map grows large, evict expired buckets.
  if (buckets.size > MAX_KEYS) {
    for (const [k, timestamps] of buckets) {
      if (timestamps.every((t) => now - t >= windowMs)) buckets.delete(k);
    }
  }

  const recent = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    buckets.set(key, recent);
    return true;
  }

  recent.push(now);
  buckets.set(key, recent);
  return false;
}
