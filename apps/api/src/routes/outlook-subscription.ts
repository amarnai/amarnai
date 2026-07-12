import { Hono } from "hono";
import { z } from "zod";
import { registerOutlookSubscription } from "../services/outlook-subscription.js";

const workspaceParam = z.object({ workspaceId: z.string().min(1) });

const outlookSubscription = new Hono();

/**
 * POST /workspaces/:workspaceId/register-outlook-subscription
 *
 * Creates a Microsoft Graph change-notification subscription for the workspace's
 * connected Outlook inbox, pointing at MS_GRAPH_NOTIFICATION_URL so Graph pushes
 * change notifications in real time.
 *
 * Called fire-and-forget from the web Outlook OAuth callback immediately after a
 * connection is established. The worker's renewal tick renews the ~70h expiry.
 *
 * No-ops when MS_GRAPH_NOTIFICATION_URL is unset or not HTTPS (polling-only
 * deployments, incl. local dev on http://localhost — Graph rejects non-HTTPS
 * notification URLs). Returns 200 with { ok: false, reason } in those cases so
 * the fire-and-forget caller does not log a failure.
 */
outlookSubscription.post("/workspaces/:workspaceId/register-outlook-subscription", async (c) => {
  const parsed = workspaceParam.safeParse({ workspaceId: c.req.param("workspaceId") });
  if (!parsed.success) return c.json({ error: "Invalid workspace ID" }, 400);

  const result = await registerOutlookSubscription(parsed.data.workspaceId);
  if (!result.ok) {
    if (result.reason === "no_notification_url") {
      return c.json({ ok: false, reason: "MS_GRAPH_NOTIFICATION_URL not configured" });
    }
    if (result.reason === "notification_url_not_https") {
      return c.json({ ok: false, reason: "MS_GRAPH_NOTIFICATION_URL is not HTTPS" });
    }
    if (result.reason === "wrong_provider") {
      return c.json({ error: "Workspace connection is not an Outlook inbox" }, 422);
    }
    return c.json({ error: "No active Outlook connection" }, 422);
  }

  return c.json({ ok: true });
});

export { outlookSubscription as outlookSubscriptionRoute };
