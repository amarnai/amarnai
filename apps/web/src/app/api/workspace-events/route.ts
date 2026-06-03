import { type NextRequest } from "next/server";
import { Redis } from "ioredis";
import { db } from "@amarnai/db";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const REDIS_URL = process.env["REDIS_URL"] ?? "redis://localhost:6379";

/**
 * GET /api/workspace-events?workspaceId=<id>
 *
 * Authenticates the session, verifies workspace membership, then opens a
 * Server-Sent Events stream backed by a Redis subscriber. Emits a `synced`
 * event whenever the sync-inbox worker finishes processing inbox changes.
 *
 * Subscribes to Redis directly — avoids a double-streaming proxy hop through
 * the internal API, which can cause buffering in Next.js's fetch layer.
 */
export async function GET(req: NextRequest) {
  const user = await requireUser().catch(() => null);
  if (!user) return new Response("Unauthorized", { status: 401 });

  const workspaceId = req.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) return new Response("Missing workspaceId", { status: 400 });

  const workspace = await db.workspace.findFirst({
    where: {
      id: workspaceId,
      OR: [
        { ownerUserId: user.id },
        { members: { some: { userId: user.id } } },
      ],
    },
    select: { id: true },
  });
  if (!workspace) return new Response("Workspace not found", { status: 404 });

  const channel = `workspace:${workspaceId}:synced`;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const subscriber = new Redis(REDIS_URL, { maxRetriesPerRequest: null });

      function send(event: string, data: string) {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
      }

      subscriber.on("error", () => {
        // Suppress ioredis connection errors; EventSource auto-reconnects.
      });

      subscriber.on("message", (_ch: string, _msg: string) => {
        console.log(`[sse] Received Redis message on ${channel} — forwarding synced event`);
        send("synced", workspaceId);
      });

      subscriber.subscribe(channel).catch(() => {
        controller.close();
        subscriber.quit().catch(() => {});
      });

      // Heartbeat every 25s — keeps the connection alive through proxies and
      // prevents EventSource's default 3s reconnection from firing on idle streams.
      const heartbeat = setInterval(() => {
        try {
          send("heartbeat", "");
        } catch {
          clearInterval(heartbeat);
        }
      }, 25_000);

      // Initial handshake so the browser knows the stream is live.
      send("connected", workspaceId);

      req.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        subscriber.quit().catch(() => {});
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
