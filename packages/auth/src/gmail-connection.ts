import { db, deleteGmailDisconnectedNotifications } from "@amarnai/db";
import { encrypt, fetchGmailProfile } from "@amarnai/gmail";

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
  const profile = await fetchGmailProfile(accessToken);
  const encryptedRefreshToken = encrypt(refreshToken);

  const connectionData = {
    gmailAddress: profile.emailAddress,
    encryptedRefreshToken,
    grantedScopes,
    status: "ACTIVE" as const,
    lastVerifiedAt: new Date(),
  };

  await db.gmailConnection.upsert({
    where: { workspaceId },
    create: { workspaceId, ...connectionData },
    update: connectionData,
  });

  // Connection is ACTIVE again — clear any "reconnect your account" nudge so it
  // doesn't linger after a successful reconnect. Best-effort.
  await deleteGmailDisconnectedNotifications(workspaceId).catch(() => {});

  return { gmailAddress: profile.emailAddress };
}
