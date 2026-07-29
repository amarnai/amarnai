import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { Redis } from "ioredis";
import { z } from "zod";
import { config } from "@amarnai/config";

const workspaceParam = z.object({ workspaceId: z.string().min(1) });

const workspaceEvents = new Hono();

/**
 * GET /workspaces/:workspaceId/events
 *
 * Server-Sent Events stream for a workspace. Emits:
 *   - `synced` whenever the sync-inbox worker finishes processing inbox changes,
 *     letting connected browser tabs refresh immediately without polling;
 *   - `thread` whenever one thread reaches a terminal sorting outcome, carrying
 *     {type, threadId, providerThreadId} so a surface watching a single thread
 *     (the panel injected into Gmail/Outlook) can tell whether it is the one on
 *     screen. Clients that predate this event ignore it, per the SSE spec.
 *
 * Authentication: covered by the auth middleware in app.ts, which accepts both
 * the internal service secret and a per-user access token, plus the workspace-
 * membership guard. Browsers connect via the Next.js proxy at
 * /api/workspace-events (which authenticates the session and adds the internal
 * auth header); the mobile app connects directly with its bearer token.
 *
 * One Redis subscriber connection is created per connected client and cleaned
 * up when the browser tab closes. A heartbeat is sent every 30 s to prevent
 * reverse proxies from closing idle connections.
 */
workspaceEvents.get("/workspaces/:workspaceId/events", (c) => {
  const parsed = workspaceParam.safeParse({ workspaceId: c.req.param("workspaceId") });
  if (!parsed.success) return c.json({ error: "Invalid workspace ID" }, 400);

  const { workspaceId } = parsed.data;
  const syncedChannel = `workspace:${workspaceId}:synced`;
  const threadChannel = `workspace:${workspaceId}:thread-events`;

  return streamSSE(c, async (stream) => {
    const subscriber = new Redis(config.redis.url, { maxRetriesPerRequest: null });

    await new Promise<void>((resolve) => {
      stream.onAbort(async () => {
        await subscriber.quit().catch(() => {});
        resolve();
      });

      subscriber.on("error", (err: Error) => {
        console.error(`[workspace-events] Redis subscriber error (workspace=${workspaceId}):`, err.message);
      });

      // One subscriber, two channels — so the payload has to be read now, where
      // the `synced` handler used to discard it. The thread payload is forwarded
      // verbatim: it is a small JSON object of ids produced by the worker, never
      // email content, and re-parsing it here would only add a failure mode.
      subscriber.on("message", (channel: string, message: string) => {
        const frame =
          channel === threadChannel
            ? { event: "thread", data: message }
            : { event: "synced", data: workspaceId };
        stream.writeSSE(frame).catch(() => resolve());
      });

      subscriber.subscribe(syncedChannel, threadChannel).catch((err) => {
        console.error(`[workspace-events] Subscribe failed (workspace=${workspaceId}):`, err.message);
        resolve();
      });

      // Heartbeat — keeps the connection alive through nginx/Caddy/CDN proxies.
      const heartbeat = setInterval(() => {
        stream.writeSSE({ event: "heartbeat", data: "" }).catch(() => {
          clearInterval(heartbeat);
          resolve();
        });
      }, 30_000);

      // Send initial event so the browser knows the connection is live.
      stream.writeSSE({ event: "connected", data: workspaceId }).catch(() => {
        clearInterval(heartbeat);
        resolve();
      });
    });
  });
});

export { workspaceEvents as workspaceEventsRoute };
