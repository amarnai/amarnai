import { db, Prisma } from "@amarnai/db";
import { GMAIL_READONLY_SCOPE } from "@amarnai/gmail";
import { getOrCreateDefaultWorkspace } from "./workspace.js";
import { storeGmailConnection, ProviderMismatchError } from "./gmail-connection.js";

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
  const { userId, isNew } = await upsertGoogleUser(input);

  if (!input.gmailAccessToken || !input.gmailRefreshToken) {
    return { userId, workspaceId: null, isNew, gmailConnected: false };
  }

  try {
    const workspace = await getOrCreateDefaultWorkspace(userId, input.locale);
    await storeGmailConnection({
      workspaceId: workspace.id,
      accessToken: input.gmailAccessToken,
      refreshToken: input.gmailRefreshToken,
      grantedScopes: input.grantedScopes ?? [GMAIL_READONLY_SCOPE],
    });

    return { userId, workspaceId: workspace.id, isNew, gmailConnected: true };
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
    return { userId, workspaceId: null, isNew, gmailConnected: false };
  }
}

// Upserts the Google user and, on the null -> verified transition, invalidates any
// untrusted pre-verification password credential — in the SAME transaction as the
// verify flip, so a partial failure can never leave the account credential-less
// yet unverified (the state a caller-retry would then mis-handle). Retries once on
// a create/create race from a double OAuth callback. Returns the user id and
// whether this sign-in created the record.
async function upsertGoogleUser(
  input: ProvisionGoogleUserInput
): Promise<{ userId: string; isNew: boolean }> {
  for (let attempt = 0; ; attempt++) {
    const existing = await db.user.findUnique({
      where: { email: input.email },
      select: {
        id: true,
        emailVerified: true,
        googleLinkedAt: true,
        credential: { select: { id: true } },
      },
    });
    const isNew = existing === null;

    // Mark the Google linkage the first time it happens and keep the original
    // timestamp on later sign-ins. Durable proof the account is truly federated,
    // which the register/forgot-password flows read so they never treat a
    // passwordless email-first account as a Google account.
    const googleLinkedAt = existing?.googleLinkedAt ?? new Date();

    try {
      const user = await db.$transaction(async (tx) => {
        // First-time verification via Google of an account that already carries a
        // password set while it was still unverified. That password is untrusted
        // (an unauthenticated caller may have planted it via /auth/register on an
        // email they do not control). This Google grant is the first proof of
        // mailbox ownership but does not vouch for that password, so we invalidate
        // the credential and revoke any API sessions it opened — ATOMICALLY with
        // the emailVerified flip below, so the account is never observably
        // credential-less-but-unverified. The epoch bump kills any planted
        // stateless web JWT. Fires only on the null -> verified transition; a
        // returning verified user's password is never touched.
        if (existing && existing.emailVerified === null && existing.credential !== null) {
          await tx.user.update({
            where: { id: existing.id },
            data: { sessionEpoch: { increment: 1 } },
          });
          await tx.refreshToken.deleteMany({ where: { userId: existing.id } });
          await tx.userCredential.deleteMany({ where: { userId: existing.id } });
        }

        return tx.user.upsert({
          where: { email: input.email },
          update: {
            ...(input.name != null ? { name: input.name } : {}),
            ...(input.imageUrl != null ? { imageUrl: input.imageUrl } : {}),
            emailVerified: new Date(),
            googleLinkedAt,
          },
          create: {
            email: input.email,
            name: input.name ?? null,
            imageUrl: input.imageUrl ?? null,
            emailVerified: new Date(),
            googleLinkedAt,
          },
          select: { id: true },
        });
      });
      return { userId: user.id, isNew };
    } catch (err) {
      // Double OAuth callback: two concurrent provisions both saw no row and both
      // tried to create. The loser hits the unique-email constraint; re-read (the
      // row now exists) and retry once, taking the update path.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002" &&
        attempt === 0
      ) {
        continue;
      }
      throw err;
    }
  }
}
