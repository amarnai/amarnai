import { db } from "@amarnai/db";
import { config } from "@amarnai/config";
import { GmailClient } from "./gmail-client.js";

export type RegisterGmailWatchResult =
  | { ok: true; expiresAt: Date }
  | { ok: false; reason: "no_pubsub_topic" | "no_active_connection" };

/**
 * Registers (or renews) the Gmail push watch for a single workspace's connected
 * inbox and persists the new expiry, so real-time Pub/Sub is armed the moment an
 * inbox connects rather than waiting for the worker's daily renewal.
 *
 * Shared by the register-gmail-watch route and the connect flows (web calls the
 * route over HTTP; the in-process API connect endpoints call this directly).
 * Refreshes with the connection's originating OAuth client. No-ops when
 * GMAIL_PUBSUB_TOPIC is unset (polling-only deployments).
 */
export async function registerGmailWatch(
  workspaceId: string,
): Promise<RegisterGmailWatchResult> {
  if (!config.gmail.pubsubTopic) return { ok: false, reason: "no_pubsub_topic" };

  const connection = await db.gmailConnection.findUnique({
    where: { workspaceId },
    select: {
      encryptedRefreshToken: true,
      oauthClient: true,
      status: true,
      gmailAddress: true,
    },
  });
  if (!connection || connection.status !== "ACTIVE") {
    return { ok: false, reason: "no_active_connection" };
  }

  const client = new GmailClient(connection.encryptedRefreshToken, connection.oauthClient);
  const result = await client.watchInbox(config.gmail.pubsubTopic);
  const expiresAt = new Date(Number(result.expiration));
  await db.gmailConnection.update({
    where: { workspaceId },
    data: { gmailWatchExpiresAt: expiresAt },
  });

  console.log(
    `[gmail-watch] Registered push watch for ${connection.gmailAddress} (workspace=${workspaceId}) expires=${expiresAt.toISOString()}`,
  );
  return { ok: true, expiresAt };
}
