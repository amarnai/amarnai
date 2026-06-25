import { db } from "@amarnai/db";
import { GMAIL_READONLY_SCOPE } from "@amarnai/gmail";
import { getOrCreateDefaultWorkspace } from "./workspace.js";
import { storeGmailConnection } from "./gmail-connection.js";

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
    select: { id: true },
  });
  const isNew = existing === null;

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
    console.error(
      "[provisionGoogleUser] gmail_setup:",
      err instanceof Error ? err.message : err
    );
    return { userId: user.id, workspaceId: null, isNew, gmailConnected: false };
  }
}
