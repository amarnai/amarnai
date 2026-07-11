import { db } from "@amarnai/db";
import { GMAIL_READONLY_SCOPE } from "@amarnai/gmail";
import { getOrCreateDefaultWorkspace } from "./workspace.js";
import { storeGmailConnection, ProviderMismatchError } from "./gmail-connection.js";
import { revokeAllRefreshTokensForUser } from "./refresh-token.js";

export type ProvisionGoogleUserInput = {
  email: string;
  name?: string | null;
  imageUrl?: string | null;
  // Present after a successful OAuth grant. When both are supplied the user's
  // default workspace is created and the Gmail connection is stored.
  gmailAccessToken?: string | null;
  gmailRefreshToken?: string | null;
  // Scopes Google actually granted. Defaults to gmail.readonly (the MVP scope).
  grantedScopes?: string[];
  // Creator's resolved locale; seeds the default workspace's language.
  locale?: string;
};

export type ProvisionGoogleUserResult = {
  userId: string;
  // The default workspace id when a Gmail connection was established, else null.
  workspaceId: string | null;
  // True when this sign-in created the user record (first-ever sign-in).
  isNew: boolean;
  gmailConnected: boolean;
};

// Upserts the Google user and, when OAuth tokens are present, provisions their
// default workspace and stores the Gmail connection (refresh token encrypted at
// rest). Shared by the web next-auth signIn callback and the API /auth/google
// endpoint. Gmail setup failures are non-fatal: the user is still returned so
// sign-in succeeds and the connection can be retried from settings.
//
// Post-provision side effects (immediate inbox sync, push-watch registration)
// are intentionally left to the caller, since the web app and the API reach the
// queue/Gmail watch through different transports.
export async function provisionGoogleUser(
  input: ProvisionGoogleUserInput
): Promise<ProvisionGoogleUserResult> {
  const existing = await db.user.findUnique({
    where: { email: input.email },
    select: { id: true, emailVerified: true, credential: { select: { id: true } } },
  });
  const isNew = existing === null;

  // First-time verification via Google of an account that already carries a
  // password credential set while it was still unverified. That password is
  // untrusted: an unauthenticated caller may have planted it via /auth/register
  // on an email they do not control. This Google grant is the first proof of
  // mailbox ownership, but it does not vouch for a password set beforehand, so we
  // invalidate the credential and revoke any API sessions it may have opened
  // before the upsert flips emailVerified. This fires only on the null -> verified
  // transition; a returning verified user's password (set via the authenticated
  // reset flow) is never touched.
  //
  // Bump the session epoch and revoke tokens BEFORE deleting the credential so the
  // step is retry-safe: the credential is what re-arms this guard, so if any of
  // these writes fail and the caller retries, we re-enter (credential still
  // present) and redo them. Deleting first would drop the guard, and a retry after
  // a failed revoke/bump would skip invalidation entirely, leaving planted
  // sessions alive. The epoch bump invalidates any stateless web JWT the planted
  // credential may have opened (revokeAllRefreshTokensForUser only clears the API
  // refresh tokens); re-incrementing on a retry is harmless (monotonic).
  if (existing && existing.emailVerified === null && existing.credential !== null) {
    await db.user.update({
      where: { id: existing.id },
      data: { sessionEpoch: { increment: 1 } },
    });
    await revokeAllRefreshTokensForUser(existing.id);
    await db.userCredential.deleteMany({ where: { userId: existing.id } });
  }

  const user = await db.user.upsert({
    where: { email: input.email },
    update: {
      ...(input.name != null ? { name: input.name } : {}),
      ...(input.imageUrl != null ? { imageUrl: input.imageUrl } : {}),
      emailVerified: new Date(),
    },
    create: {
      email: input.email,
      name: input.name ?? null,
      imageUrl: input.imageUrl ?? null,
      emailVerified: new Date(),
    },
    select: { id: true },
  });

  if (!input.gmailAccessToken || !input.gmailRefreshToken) {
    return { userId: user.id, workspaceId: null, isNew, gmailConnected: false };
  }

  try {
    const workspace = await getOrCreateDefaultWorkspace(user.id, input.locale);
    await storeGmailConnection({
      workspaceId: workspace.id,
      accessToken: input.gmailAccessToken,
      refreshToken: input.gmailRefreshToken,
      grantedScopes: input.grantedScopes ?? [GMAIL_READONLY_SCOPE],
    });

    return { userId: user.id, workspaceId: workspace.id, isNew, gmailConnected: true };
  } catch (err) {
    // A returning user whose default workspace is connected to a non-Gmail
    // provider (e.g. Outlook): sign-in still succeeds, and we deliberately leave
    // that connection untouched instead of resurrecting/clobbering it with Gmail.
    // Expected, not an error worth logging.
    if (!(err instanceof ProviderMismatchError)) {
      console.error(
        "[provisionGoogleUser] gmail_setup:",
        err instanceof Error ? err.message : err
      );
    }
    return { userId: user.id, workspaceId: null, isNew, gmailConnected: false };
  }
}
