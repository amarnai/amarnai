import { config } from "@amarnai/config";
import { createRedisSingleton } from "./redis-singleton.js";

// Lazily-created singleton publisher connection.
// Kept separate from BullMQ's connections: a Redis subscriber/publisher must
// not share a connection used for normal commands.
const publisher = createRedisSingleton(config.redis.url, "redis-publisher", {
  maxRetriesPerRequest: null,
});

export async function closePublisher(): Promise<void> {
  await publisher.close();
}

/** Notifies all SSE subscribers that a workspace's inbox was just synced. */
export async function publishWorkspaceSynced(workspaceId: string): Promise<void> {
  const channel = `workspace:${workspaceId}:synced`;
  const receivers = await publisher.get().publish(channel, workspaceId);
  console.log(`[redis-publisher] PUBLISH ${channel} → ${receivers} subscriber(s)`);
}
