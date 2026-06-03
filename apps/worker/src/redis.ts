import { config } from "@amarnai/config";
import { parseRedisUrl } from "@amarnai/queue";

export const redisConnection = parseRedisUrl(config.redis.url);
