import { auth } from "@/auth";
import { db } from "@amarnai/db";
import { verifyAccessToken } from "@amarnai/auth";
import { getSelectedWorkspace } from "@/lib/workspace";

export type BillingAuthResult =
  | { ok: true; userId: string }
  | { ok: false; status: number; error: string };

/**
 * Resolve the acting user for a billing request.
 *
 * A Bearer JWT wins over the web session cookie. The token is an explicit
 * assertion of identity made by the caller; the cookie is ambient, belonging to
 * whichever account the browser happens to be signed into. They are routinely
 * different people: the extension panel calls these routes with its own token
 * from a browser that may hold a web session for another account entirely, and
 * letting the cookie win there charges the wrong workspace or, more often,
 * refuses a request the caller was perfectly entitled to make.
 *
 * Enforces verify-before-pay with an authoritative DB read so a charge or
 * billing change can never originate from an unverified (or vanished) account,
 * even if the middleware matcher changes.
 */
export async function resolveBillingUser(request: Request): Promise<BillingAuthResult> {
  let userId: string | undefined;
  // Set only on the Bearer-token path, to enforce the session epoch below. The
  // web session cookie is already epoch-enforced in the next-auth jwt callback.
  let tokenEpoch: number | undefined;

  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const verified = await verifyAccessToken(authHeader.slice(7));
    if (verified) {
      userId = verified.userId;
      tokenEpoch = verified.sessionEpoch;
    }
  }

  if (!userId) {
    const session = await auth();
    if (session?.user?.id) userId = session.user.id;
  }

  if (!userId) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  const userRecord = await db.user.findUnique({
    where: { id: userId },
    select: { emailVerified: true, sessionEpoch: true },
  });
  if (!userRecord) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  // Reject an access token minted before the account's epoch advanced (password
  // reset / pre-hijack invalidation), matching the API bearer middleware.
  if (tokenEpoch !== undefined && tokenEpoch < userRecord.sessionEpoch) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  if (!userRecord.emailVerified) {
    return { ok: false, status: 403, error: "Email not verified" };
  }

  return { ok: true, userId };
}

/**
 * Resolve the workspace a billing request targets.
 *
 * Mobile clients pass `workspaceId` explicitly (no cookie-selected workspace);
 * web falls back to the cookie selection. Returns null if the user is not a
 * member of an explicitly requested workspace.
 */
export async function resolveBillingWorkspaceId(
  userId: string,
  requestedWorkspaceId?: string,
): Promise<string | null> {
  if (requestedWorkspaceId) {
    const ws = await db.workspace.findFirst({
      where: { id: requestedWorkspaceId, members: { some: { userId } } },
      select: { id: true },
    });
    return ws?.id ?? null;
  }
  const selected = await getSelectedWorkspace(userId);
  return selected.id;
}
