import { config } from "@aziru/config";
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

/**
 * One thread reached a terminal sorting outcome.
 *
 * Separate from the workspace-level `synced` event because the audience is
 * different: `synced` says "the list may have changed, refetch it", while this
 * says "this exact thread changed". The panel injected into Gmail/Outlook is
 * looking at one thread and knows it only by the provider's id, so both ids
 * travel with the event and it can ignore everything that is not on screen.
 *
 * Carries no subject, sender, or body — the payload crosses Redis and is not the
 * place for email content. A subscriber that wants detail refetches the thread.
 */
export type ThreadEvent = {
  type: "classified" | "quota_blocked";
  threadId: string;
  providerThreadId: string;
};

export async function publishThreadEvent(
  workspaceId: string,
  event: ThreadEvent,
): Promise<void> {
  const channel = `workspace:${workspaceId}:thread-events`;
  const receivers = await publisher.get().publish(channel, JSON.stringify(event));
  console.log(
    `[redis-publisher] PUBLISH ${channel} (${event.type}, thread=${event.threadId}) → ${receivers} subscriber(s)`,
  );
}
