import { Hono } from "hono";
import { z } from "zod";
import { db } from "@amarnai/db";
import { config } from "@amarnai/config";
import { syncInboxQueue } from "../services/queue-client.js";
import { constantTimeEqual } from "../services/constant-time-equal.js";

// A single Graph change-notification item. We only need the fields used to
// authenticate the callback (clientState) and identify the mailbox (resource).
const notificationItem = z.object({
  clientState: z.string().optional(),
  resource: z.string().optional(),
});

const notificationEnvelope = z.object({
  value: z.array(notificationItem),
});

/**
 * Pull the Entra user object id out of a Graph notification `resource` path.
 * Delegated /me subscriptions notify with a resource like
 * "Users/{user-object-id}/Messages/{message-id}", and that object id is exactly
 * the `subjectId` we captured from GET /me at connect time — so we map the
 * notification to a connection by subjectId, no extra stored subscription id.
 */
function extractSubjectId(resource: string | undefined): string | null {
  if (!resource) return null;
  const match = resource.match(/[Uu]sers\/([^/]+)/);
  return match?.[1] ?? null;
}

const outlookWebhook = new Hono();

/**
 * POST /webhooks/outlook
 *
 * Receives Microsoft Graph change notifications for Outlook mailboxes.
 *
 * Two request shapes:
 *  1. Validation handshake — on subscription create/renew, Graph POSTs with a
 *     ?validationToken=<token> query param and expects the token echoed back as
 *     text/plain with 200 within 10 seconds.
 *  2. Change notification — a JSON envelope of items. Each carries the
 *     clientState secret (verified against MS_GRAPH_SUBSCRIPTION_SECRET) and a
 *     resource path identifying the mailbox. We enqueue a sync-inbox job per
 *     matching workspace and return 202 quickly.
 *
 * This route is excluded from the INTERNAL_API_SECRET middleware in app.ts.
 */
outlookWebhook.post("/webhooks/outlook", async (c) => {
  // ── Validation handshake ────────────────────────────────────────────────────
  // Must run before body parsing: Graph sends the token in the query string.
  const validationToken = c.req.query("validationToken");
  if (validationToken) {
    return c.text(validationToken, 200);
  }

  // ── Parse the notification envelope ─────────────────────────────────────────
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const envelope = notificationEnvelope.safeParse(body);
  if (!envelope.success) return c.json({ error: "Invalid envelope" }, 400);

  // ── Authenticate each item and collect mailbox subject ids ──────────────────
  const secret = config.outlook.subscriptionSecret;
  const subjectIds = new Set<string>();
  for (const item of envelope.data.value) {
    // Reject spoofed callbacks: every genuine notification echoes our
    // clientState. Constant-time compare so a wrong clientState cannot be
    // brute-forced via response timing; an unconfigured secret rejects.
    if (!secret || !constantTimeEqual(item.clientState, secret)) continue;
    const subjectId = extractSubjectId(item.resource);
    if (subjectId) subjectIds.add(subjectId);
  }

  // Nothing to act on (all items failed verification or lacked a resource).
  // Still 202 so Graph does not retry.
  if (subjectIds.size === 0) return c.body(null, 202);

  // ── Find all active Outlook workspaces for these mailboxes ──────────────────
  const connections = await db.emailConnection.findMany({
    where: {
      provider: "OUTLOOK",
      status: "ACTIVE",
      subjectId: { in: [...subjectIds] },
    },
    select: { workspaceId: true },
  });

  if (connections.length === 0) {
    // Subject ids are opaque directory object ids, safe to log. Surfacing them
    // matters: a silent drop here looks identical to "no notification arrived"
    // and hides subject-id format mismatches between GET /me (connect time) and
    // the notification resource path.
    console.log(
      `[outlook-webhook] Notification matched no active connection — subject id(s): ${[...subjectIds].join(", ")}`
    );
    return c.body(null, 202);
  }

  // ── Enqueue sync-inbox for each matching workspace ──────────────────────────
  await syncInboxQueue.addBulk(
    connections.map(({ workspaceId }) => ({
      name: "sync-inbox",
      data: { workspaceId },
      opts: { deduplication: { id: `sync-inbox_${workspaceId}` } },
    }))
  );

  console.log(
    `[outlook-webhook] Notification received — sync-inbox enqueued for ${connections.length} workspace(s)`
  );

  return c.body(null, 202);
});

export { outlookWebhook as outlookWebhookRoute };
