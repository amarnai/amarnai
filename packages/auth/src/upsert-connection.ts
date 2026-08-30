import { db } from "@aziru/db";
import type { ConnectionProvider } from "./connection-guard.js";

export type UpsertEmailConnectionInput = {
  workspaceId: string;
  provider: ConnectionProvider;
  // Stable provider subject id (Outlook Entra object id). Null for Gmail, which
  // exposes no stable id for gmail.readonly-only access.
  subjectId: string | null;
  emailAddress: string;
  encryptedRefreshToken: string;
  grantedScopes: string[];
  // Personal (MSA) vs work/school, for Outlook. Decides which Outlook-on-the-web
  // host the mailbox opens on. Null for Gmail, and null when the connect flow
  // could not determine it (no id_token) — the backfill script fills those in.
  outlookAccountType?: "PERSONAL" | "ORGANIZATION" | null;
};

/**
 * Upsert the workspace's single EmailConnection, resetting EVERY provider-scoped
 * field so connecting a provider can never inherit stale state from a prior one.
 *
 * This is the single place every connect path writes the connection row (both
 * OAuth callbacks via persistEmailConnection, plus storeGmailConnection /
 * storeOutlookConnection), so the reset set cannot drift between them. The bug
 * this prevents: updating only a subset of columns left `provider`, `subjectId`,
 * or a stale `watchExpiresAt` pointing at the previous connection.
 *
 * status is set ACTIVE and the push-watch expiry cleared to null (the caller's
 * post-connect hooks re-register the watch/subscription and stamp a fresh expiry).
 */
export async function upsertEmailConnection(
  input: UpsertEmailConnectionInput,
): Promise<void> {
  const connectionData = {
    provider: input.provider,
    subjectId: input.subjectId,
    emailAddress: input.emailAddress,
    encryptedRefreshToken: input.encryptedRefreshToken,
    grantedScopes: input.grantedScopes,
    outlookAccountType: input.outlookAccountType ?? null,
    status: "ACTIVE" as const,
    lastVerifiedAt: new Date(),
    watchExpiresAt: null,
  };

  await db.emailConnection.upsert({
    where: { workspaceId: input.workspaceId },
    create: { workspaceId: input.workspaceId, ...connectionData },
    update: connectionData,
  });
}
