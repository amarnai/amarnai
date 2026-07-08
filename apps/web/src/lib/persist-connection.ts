import { db } from "@amarnai/db";
import type { MailProvider } from "@/lib/api";

type PersistConnectionInput = {
  workspaceId: string;
  provider: MailProvider;
  // Stable provider subject id (Outlook Entra object id). Null for Gmail, which
  // exposes no stable id for gmail.readonly-only access.
  subjectId: string | null;
  emailAddress: string;
  encryptedRefreshToken: string;
  grantedScopes: string[];
};

/**
 * Upsert the workspace's single EmailConnection, resetting EVERY provider-scoped
 * field so connecting a provider can never inherit stale state from a prior one.
 *
 * This is the single place both OAuth callbacks persist a connection, so Gmail
 * and Outlook cannot drift apart. The bug this prevents: switching Outlook →
 * Gmail while only updating a subset of columns left `provider` and `subjectId`
 * pointing at Outlook, so the sync built an Outlook adapter around a Gmail token
 * and auth-failed, disconnecting the freshly connected inbox.
 *
 * status is set ACTIVE and the push-watch expiry cleared (the post-connect hooks
 * re-register the watch/subscription).
 */
export async function persistEmailConnection(
  input: PersistConnectionInput,
): Promise<void> {
  const {
    workspaceId,
    provider,
    subjectId,
    emailAddress,
    encryptedRefreshToken,
    grantedScopes,
  } = input;

  const connectionData = {
    provider,
    subjectId,
    emailAddress,
    encryptedRefreshToken,
    grantedScopes,
    status: "ACTIVE" as const,
    lastVerifiedAt: new Date(),
    watchExpiresAt: null,
  };

  await db.emailConnection.upsert({
    where: { workspaceId },
    create: { workspaceId, ...connectionData },
    update: connectionData,
  });
}
