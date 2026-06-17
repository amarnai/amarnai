import { Redis, type RedisOptions } from "ioredis";

// A lazily-created singleton ioredis connection.
//
// Both the SSE publisher and the AI retry-dedup cache need their own connection,
// kept out of BullMQ's command connection, but with very different tuning: the
// publisher wants unlimited retries (maxRetriesPerRequest: null), the dedup
// cache wants fail-fast so a dead Redis never stalls a job. Options are passed
// in per call site so that divergence stays explicit and is never accidentally
// copied between them.

export type RedisSingleton = {
  /** The connection, created on first use. */
  get(): Redis;
  /** Quit and reset, so a later get() reconnects. Safe to call when unused. */
  close(): Promise<void>;
};

export function createRedisSingleton(
  url: string,
  label: string,
  options: RedisOptions,
): RedisSingleton {
  let client: Redis | null = null;

  return {
    get(): Redis {
      if (!client) {
        client = new Redis(url, options);
        client.on("error", (err: Error) => {
          console.error(`[${label}] Connection error:`, err.message);
        });
      }
      return client;
    },
    async close(): Promise<void> {
      if (!client) return;
      // quit() rejects if the connection is already gone ("Connection is
      // closed.") — common during a SIGTERM when Redis is shutting down too.
      // Swallow it so callers (e.g. the worker shutdown sequence) always
      // proceed to disconnect the DB and exit cleanly.
      try {
        await client.quit();
      } catch (err) {
        console.error(`[${label}] Close failed, ignoring:`, (err as Error).message);
      }
      client = null;
    },
  };
}
