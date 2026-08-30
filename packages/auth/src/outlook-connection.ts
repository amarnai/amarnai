import { deleteGmailDisconnectedNotifications } from "@aziru/db";
import { encrypt } from "@aziru/gmail";
import { fetchOutlookProfile } from "@aziru/outlook";
import { assertNoProviderConflict } from "./connection-guard.js";
import { upsertEmailConnection } from "./upsert-connection.js";

export type StoreOutlookConnectionInput = {
  workspaceId: string;
  accessToken: string;
  refreshToken: string;
  grantedScopes: string[];
  // Personal (MSA) vs work/school, read from the sign-in token's tenant claim by
  // the caller that redeemed it. Null when the grant carried no id_token.
  outlookAccountType?: "PERSONAL" | "ORGANIZATION" | null;
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
  outlookAccountType = null,
}: StoreOutlookConnectionInput): Promise<{ emailAddress: string }> {
  await assertNoProviderConflict(workspaceId, "OUTLOOK");

  const profile = await fetchOutlookProfile(accessToken);

  // Graph returns a stable subjectId (Entra object id) up front. Sets every
  // provider-scoped field so a reconnect cannot inherit stale state.
  await upsertEmailConnection({
    workspaceId,
    provider: "OUTLOOK",
    subjectId: profile.subjectId,
    emailAddress: profile.emailAddress,
    encryptedRefreshToken: encrypt(refreshToken),
    grantedScopes,
    outlookAccountType,
  });

  // Connection is ACTIVE again — clear any "reconnect your account" nudge.
  await deleteGmailDisconnectedNotifications(workspaceId).catch(() => {});

  return { emailAddress: profile.emailAddress };
}
