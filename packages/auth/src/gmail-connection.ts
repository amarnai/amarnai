import { db } from "@amarnai/db";
import { encrypt, fetchGmailProfile, type GmailOAuthClient } from "@amarnai/gmail";

export type StoreGmailConnectionInput = {
  workspaceId: string;
  accessToken: string;
  refreshToken: string;
  grantedScopes: string[];
  // Which OAuth client minted the refresh token, so the worker refreshes it with
  // the matching client. WEB = confidential server client, MOBILE = Android.
  oauthClient: GmailOAuthClient;
};

// Verifies the token by fetching the Gmail profile, encrypts the refresh token,
// and upserts the GmailConnection record. Shared by provisionGoogleUser and the
// POST /workspaces/:id/gmail-connection endpoint.
export async function storeGmailConnection({
  workspaceId,
  accessToken,
  refreshToken,
  grantedScopes,
  oauthClient,
}: StoreGmailConnectionInput): Promise<{ gmailAddress: string }> {
  const profile = await fetchGmailProfile(accessToken);
  const encryptedRefreshToken = encrypt(refreshToken);

  const connectionData = {
    gmailAddress: profile.emailAddress,
    encryptedRefreshToken,
    grantedScopes,
    oauthClient,
    status: "ACTIVE" as const,
    lastVerifiedAt: new Date(),
  };

  await db.gmailConnection.upsert({
    where: { workspaceId },
    create: { workspaceId, ...connectionData },
    update: connectionData,
  });

  return { gmailAddress: profile.emailAddress };
}
