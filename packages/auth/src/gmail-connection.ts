import { deleteGmailDisconnectedNotifications } from "@aziru/db";
import { encrypt, fetchGmailProfile } from "@aziru/gmail";
import { assertNoProviderConflict } from "./connection-guard.js";
import { upsertEmailConnection } from "./upsert-connection.js";

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

  // Gmail has no stable provider subject id (gmail.readonly exposes none), so
  // subjectId is always null. upsertEmailConnection resets every provider-scoped
  // field, so a Gmail reconnect cannot inherit a stale watch expiry (or, absent
  // the cross-provider guard above, stale Outlook provider/subjectId).
  await upsertEmailConnection({
    workspaceId,
    provider: "GMAIL",
    subjectId: null,
    emailAddress: profile.emailAddress,
    encryptedRefreshToken: encrypt(refreshToken),
    grantedScopes,
  });

  // Connection is ACTIVE again — clear any "reconnect your account" nudge so it
  // doesn't linger after a successful reconnect. Best-effort.
  await deleteGmailDisconnectedNotifications(workspaceId).catch(() => {});

  return { gmailAddress: profile.emailAddress };
}
