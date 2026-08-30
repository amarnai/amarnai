import { config } from "@aziru/config";
import { parseRedisUrl } from "@aziru/queue";

export const redisConnection = parseRedisUrl(config.redis.url);
