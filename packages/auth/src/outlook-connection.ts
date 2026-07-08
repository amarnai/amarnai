import { db, deleteGmailDisconnectedNotifications } from "@amarnai/db";
import { encrypt } from "@amarnai/gmail";
import { fetchOutlookProfile } from "@amarnai/outlook";
import { assertNoProviderConflict } from "./connection-guard.js";

export type StoreOutlookConnectionInput = {
  workspaceId: string;
  accessToken: string;
  refreshToken: string;
  grantedScopes: string[];
};

// Verifies the token via Graph /me, encrypts the refresh token, and upserts the
// Outlook connection row. The API's Outlook connect endpoint (browser extension)
// shares this, mirroring how the web Outlook callback uses persistEmailConnection
// and how Gmail uses storeGmailConnection. Sets every provider-scoped field so a
// reconnect cannot inherit stale state, and refuses to clobber a connection that
// belongs to a different provider. Token encryption (`encrypt`) is shared with
// Gmail, so the worker decrypts Outlook refresh tokens with the same key.
export async function storeOutlookConnection({
  workspaceId,
  accessToken,
  refreshToken,
  grantedScopes,
}: StoreOutlookConnectionInput): Promise<{ emailAddress: string }> {
  await assertNoProviderConflict(workspaceId, "OUTLOOK");

  const profile = await fetchOutlookProfile(accessToken);
  const encryptedRefreshToken = encrypt(refreshToken);

  const connectionData = {
    provider: "OUTLOOK" as const,
    subjectId: profile.subjectId,
    emailAddress: profile.emailAddress,
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

  // Connection is ACTIVE again — clear any "reconnect your account" nudge.
  await deleteGmailDisconnectedNotifications(workspaceId).catch(() => {});

  return { emailAddress: profile.emailAddress };
}
