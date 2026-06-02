import { Hono } from "hono";
import { z } from "zod";
import { db } from "@amarnai/db";
import { config } from "@amarnai/config";
import { GmailClient } from "../services/gmail-client.js";

const workspaceParam = z.object({ workspaceId: z.string().min(1) });

const gmailWatch = new Hono();

/**
 * POST /workspaces/:workspaceId/register-gmail-watch
 *
 * Calls gmail.users.watch() for the workspace's connected inbox, registering
 * it with the configured Pub/Sub topic so Gmail pushes change notifications
 * in real time.
 *
 * Called fire-and-forget from the Gmail OAuth callback and Google sign-in flow
 * immediately after a connection is established. The worker also calls this
 * daily for all active workspaces to renew the 7-day watch expiry.
 *
 * No-ops when GMAIL_PUBSUB_TOPIC is not configured (polling-only deployments).
 * Returns 200 with { ok: false, reason } in that case rather than an error.
 */
gmailWatch.post("/workspaces/:workspaceId/register-gmail-watch", async (c) => {
  if (!config.gmail.pubsubTopic) {
    return c.json({ ok: false, reason: "GMAIL_PUBSUB_TOPIC not configured" });
  }

  const parsed = workspaceParam.safeParse({ workspaceId: c.req.param("workspaceId") });
  if (!parsed.success) return c.json({ error: "Invalid workspace ID" }, 400);

  const { workspaceId } = parsed.data;

  const connection = await db.gmailConnection.findUnique({
    where: { workspaceId },
    select: { encryptedRefreshToken: true, status: true, gmailAddress: true },
  });

  if (!connection || connection.status !== "ACTIVE") {
    return c.json({ error: "No active Gmail connection" }, 422);
  }

  const client = new GmailClient(connection.encryptedRefreshToken);
  await client.watchInbox(config.gmail.pubsubTopic);

  console.log(`[gmail-watch] Registered push watch for ${connection.gmailAddress} (workspace=${workspaceId})`);

  return c.json({ ok: true });
});

export { gmailWatch as gmailWatchRoute };
