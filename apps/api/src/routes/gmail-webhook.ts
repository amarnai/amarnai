import { Hono } from "hono";
import { z } from "zod";
import { db } from "@amarnai/db";
import { config } from "@amarnai/config";
import { syncInboxQueue } from "../services/queue-client.js";

const pubsubEnvelope = z.object({
  message: z.object({
    data: z.string(),
  }),
});

const gmailPushPayload = z.object({
  emailAddress: z.string().email(),
  historyId: z.coerce.string(),
});

const gmailWebhook = new Hono();

/**
 * POST /webhooks/gmail
 *
 * Receives Gmail push notifications from Google Cloud Pub/Sub.
 * Authenticated via ?token=<GMAIL_PUBSUB_WEBHOOK_SECRET> in the push
 * subscription URL — set this URL when creating the Pub/Sub push subscription.
 *
 * On a valid notification, immediately enqueues a sync-inbox job for the
 * affected workspace so new messages join the routing queue with near-zero
 * latency. Pub/Sub retries on any non-2xx response, so we always return 204
 * once the payload is parsed (even if the workspace is unknown) to avoid
 * infinite retries for stale addresses.
 *
 * This route is excluded from the INTERNAL_API_SECRET middleware in app.ts.
 */
gmailWebhook.post("/webhooks/gmail", async (c) => {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const webhookSecret = config.gmail.webhookSecret;
  if (!webhookSecret || c.req.query("token") !== webhookSecret) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  // ── Parse Pub/Sub envelope ────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const envelope = pubsubEnvelope.safeParse(body);
  if (!envelope.success) return c.json({ error: "Invalid envelope" }, 400);

  // ── Decode Gmail push payload ─────────────────────────────────────────────
  let payload: z.infer<typeof gmailPushPayload>;
  try {
    const decoded = Buffer.from(envelope.data.message.data, "base64").toString("utf8");
    const payloadParsed = gmailPushPayload.safeParse(JSON.parse(decoded));
    if (!payloadParsed.success) return c.json({ error: "Invalid payload" }, 400);
    payload = payloadParsed.data;
  } catch {
    return c.json({ error: "Failed to decode message" }, 400);
  }

  // ── Find all workspaces with this Gmail address ──────────────────────────
  // Multiple workspaces can share the same Gmail address, so we enqueue
  // a sync for each one rather than stopping at the first match.
  const connections = await db.emailConnection.findMany({
    where: { emailAddress: payload.emailAddress, status: "ACTIVE" },
    select: { workspaceId: true },
  });

  if (connections.length === 0) {
    // No active workspace — acknowledge so Pub/Sub stops retrying.
    return c.body(null, 204);
  }

  // ── Enqueue sync-inbox for each matching workspace ────────────────────────
  await syncInboxQueue.addBulk(
    connections.map(({ workspaceId }) => ({
      name: "sync-inbox",
      data: { workspaceId },
      opts: { deduplication: { id: `sync-inbox_${workspaceId}` } },
    }))
  );

  console.log(
    `[gmail-webhook] Push received for ${payload.emailAddress} — sync-inbox enqueued for ${connections.length} workspace(s)`
  );

  return c.body(null, 204);
});

export { gmailWebhook as gmailWebhookRoute };
