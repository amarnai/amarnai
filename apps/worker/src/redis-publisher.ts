import { Redis } from "ioredis";
import { config } from "@amarnai/config";

// Lazily-created singleton publisher connection.
// Kept separate from BullMQ's connections: a Redis subscriber/publisher must
// not share a connection used for normal commands.
let publisher: Redis | null = null;

function getPublisher(): Redis {
  if (!publisher) {
    publisher = new Redis(config.redis.url, { maxRetriesPerRequest: null });
    publisher.on("error", (err: Error) => {
      console.error("[redis-publisher] Connection error:", err.message);
    });
  }
  return publisher;
}

export async function closePublisher(): Promise<void> {
  if (!publisher) return;
  await publisher.quit();
  publisher = null;
}

/** Notifies all SSE subscribers that a workspace's inbox was just synced. */
export async function publishWorkspaceSynced(workspaceId: string): Promise<void> {
  const channel = `workspace:${workspaceId}:synced`;
  const receivers = await getPublisher().publish(channel, workspaceId);
  console.log(`[redis-publisher] PUBLISH ${channel} → ${receivers} subscriber(s)`);
}
