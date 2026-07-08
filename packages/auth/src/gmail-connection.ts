import { db, deleteGmailDisconnectedNotifications } from "@amarnai/db";
import { encrypt, fetchGmailProfile } from "@amarnai/gmail";
import { assertNoProviderConflict } from "./connection-guard.js";

// Re-exported so existing importers keep resolving it from here; the class and
// the guard now live in ./connection-guard so Outlook can share them.
export { ProviderMismatchError } from "./connection-guard.js";

export type StoreGmailConnectionInput = {
  workspaceId: string;
  accessToken: string;
  refreshToken: string;
  grantedScopes: string[];
};

// Verifies the token by fetching the Gmail profile, encrypts the refresh token,
// and upserts the GmailConnection record. Shared by provisionGoogleUser and the
// POST /workspaces/:id/gmail-connection endpoint. All refresh tokens are minted
// against the confidential Web client (server-refreshable).
export async function storeGmailConnection({
  workspaceId,
  accessToken,
  refreshToken,
  grantedScopes,
}: StoreGmailConnectionInput): Promise<{ gmailAddress: string }> {
  // Refuse to reactivate/overwrite a connection that belongs to another provider
  // (the extension-sign-in resurrection bug). See connection-guard for details.
  await assertNoProviderConflict(workspaceId, "GMAIL");

  const profile = await fetchGmailProfile(accessToken);
  const encryptedRefreshToken = encrypt(refreshToken);

  const connectionData = {
    emailAddress: profile.emailAddress,
    encryptedRefreshToken,
    grantedScopes,
    status: "ACTIVE" as const,
    lastVerifiedAt: new Date(),
  };

  await db.emailConnection.upsert({
    where: { workspaceId },
    create: { workspaceId, ...connectionData },
    update: connectionData,
  });

  // Connection is ACTIVE again — clear any "reconnect your account" nudge so it
  // doesn't linger after a successful reconnect. Best-effort.
  await deleteGmailDisconnectedNotifications(workspaceId).catch(() => {});

  return { gmailAddress: profile.emailAddress };
}
