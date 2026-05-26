import { config } from "@amarnai/config";

/**
 * Parsed Redis connection options derived from REDIS_URL.
 *
 * BullMQ accepts a `ConnectionOptions` object (host + port + optional password)
 * rather than a raw URL, so we parse the URL here once and reuse the result
 * across all Queue and Worker instances in the process.
 */
function parseRedisUrl(url: string): { host: string; port: number; password?: string } {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port) || 6379,
    ...(parsed.password ? { password: decodeURIComponent(parsed.password) } : {}),
  };
}

export const redisConnection = parseRedisUrl(config.redis.url);
