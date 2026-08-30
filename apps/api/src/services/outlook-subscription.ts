import { db } from "@aziru/db";
import { config } from "@aziru/config";
import { createMailProvider } from "@aziru/mail";

export type RegisterOutlookSubscriptionResult =
  | { ok: true; expiresAt: Date }
  | {
      ok: false;
      reason:
        | "no_notification_url"
        | "notification_url_not_https"
        | "no_active_connection"
        | "wrong_provider";
    };

/**
 * Registers (or renews) the Microsoft Graph change-notification subscription for
 * a single workspace's connected Outlook inbox and persists the new expiry, so
 * real-time push is armed the moment an inbox connects rather than waiting for
 * the worker's renewal tick.
 *
 * The Graph analogue of registerGmailWatch. Shared by the
 * register-outlook-subscription route (web calls it over HTTP after connect) and
 * the worker's renewal tick. No-ops when MS_GRAPH_NOTIFICATION_URL is unset
 * (polling-only deployments, e.g. self-host without a public HTTPS endpoint).
 *
 * Graph subscriptions carry a hard ~70h (4230-min) max lifetime with no
 * auto-renew, so the worker must renew far more often than Gmail's 7-day watch.
 */
export async function registerOutlookSubscription(
  workspaceId: string,
): Promise<RegisterOutlookSubscriptionResult> {
  const notificationUrl = config.outlook.notificationUrl;
  if (!notificationUrl) return { ok: false, reason: "no_notification_url" };
  // Graph deterministically rejects any non-HTTPS notification URL
  // ("NotificationUrl scheme='http' is not supported"). A local dev endpoint
  // (http://localhost) can never register a subscription, so short-circuit to a
  // clean no-op — same fallback as an unset URL — rather than letting the Graph
  // 400 surface as an unhandled 500. Push stays polling-only until a public
  // HTTPS notification URL is configured.
  if (!notificationUrl.startsWith("https://")) {
    return { ok: false, reason: "notification_url_not_https" };
  }

  const connection = await db.emailConnection.findUnique({
    where: { workspaceId },
    select: {
      provider: true,
      encryptedRefreshToken: true,
      status: true,
      emailAddress: true,
    },
  });
  if (!connection || connection.status !== "ACTIVE") {
    return { ok: false, reason: "no_active_connection" };
  }
  if (connection.provider !== "OUTLOOK") {
    return { ok: false, reason: "wrong_provider" };
  }

  const client = createMailProvider(connection);
  // Graph POST /subscriptions creates a NEW subscription every call and there is
  // no stored subscription id to PATCH, so tear down any existing subscriptions
  // first to keep exactly one per mailbox. stopWatch is a no-op on first connect.
  await client.stopWatch().catch(() => {});
  const result = await client.registerWatch(notificationUrl);
  const expiresAt = new Date(Number(result.expiresAt));
  await db.emailConnection.update({
    where: { workspaceId },
    data: { watchExpiresAt: expiresAt },
  });

  console.log(
    `[outlook-subscription] Registered Graph subscription for ${connection.emailAddress} (workspace=${workspaceId}) expires=${expiresAt.toISOString()}`,
  );
  return { ok: true, expiresAt };
}
