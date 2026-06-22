import { Hono } from "hono";
import { z } from "zod";
import { registerGmailWatch } from "../services/gmail-watch.js";

const workspaceParam = z.object({ workspaceId: z.string().min(1) });

const gmailWatch = new Hono();

/**
 * POST /workspaces/:workspaceId/register-gmail-watch
 *
 * Calls gmail.users.watch() for the workspace's connected inbox, registering
 * it with the configured Pub/Sub topic so Gmail pushes change notifications
 * in real time.
 *
 * Called fire-and-forget from the web Gmail OAuth callback immediately after a
 * connection is established. The worker also calls registerGmailWatch's batch
 * sibling daily for all active workspaces to renew the 7-day watch expiry.
 *
 * No-ops when GMAIL_PUBSUB_TOPIC is not configured (polling-only deployments).
 * Returns 200 with { ok: false, reason } in that case rather than an error.
 */
gmailWatch.post("/workspaces/:workspaceId/register-gmail-watch", async (c) => {
  const parsed = workspaceParam.safeParse({ workspaceId: c.req.param("workspaceId") });
  if (!parsed.success) return c.json({ error: "Invalid workspace ID" }, 400);

  const result = await registerGmailWatch(parsed.data.workspaceId);
  if (!result.ok) {
    if (result.reason === "no_pubsub_topic") {
      return c.json({ ok: false, reason: "GMAIL_PUBSUB_TOPIC not configured" });
    }
    return c.json({ error: "No active Gmail connection" }, 422);
  }

  return c.json({ ok: true });
});

export { gmailWatch as gmailWatchRoute };
