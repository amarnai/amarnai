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
 * Server-Sent Events stream for a workspace. Emits a `synced` event whenever
 * the sync-inbox worker finishes processing inbox changes, letting connected
 * browser tabs refresh immediately without polling.
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
  const channel = `workspace:${workspaceId}:synced`;

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

      subscriber.on("message", (_channel: string, _message: string) => {
        stream.writeSSE({ event: "synced", data: workspaceId }).catch(() => resolve());
      });

      subscriber.subscribe(channel).catch((err) => {
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
