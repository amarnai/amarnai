import { Hono } from "hono";
import { z } from "zod";
import { db, maybeCreateExtensionNudge } from "@amarnai/db";
import {
  parseGrantedScopes,
  exchangeAuthCode,
  exchangeServerAuthCode,
  GmailApiError,
} from "@amarnai/gmail";
import { storeGmailConnection } from "@amarnai/auth";
import type { AppEnv } from "../env.js";
import {
  disconnectGmail,
  countActiveSiblingConnections,
  listVisibleSiblingConnections,
} from "../services/gmail-disconnect.js";
import { syncInboxQueue } from "../services/queue-client.js";
import { registerGmailWatch } from "../services/gmail-watch.js";
import { recordAudit } from "../services/audit.js";

const workspaceParam = z.object({ workspaceId: z.string().min(1) });

const connectionSelect = {
  id: true,
  workspaceId: true,
  gmailAddress: true,
  grantedScopes: true,
  status: true,
  lastVerifiedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

const gmailConnection = new Hono<AppEnv>();

gmailConnection.get("/workspaces/:workspaceId/gmail-connection", async (c) => {
  const parsed = workspaceParam.safeParse({ workspaceId: c.req.param("workspaceId") });
  if (!parsed.success) return c.json({ error: "Invalid workspace ID" }, 400);

  const workspace = await db.workspace.findUnique({
    where: { id: parsed.data.workspaceId },
    select: { id: true },
  });
  if (!workspace) return c.json({ error: "Workspace not found" }, 404);

  const connection = await db.gmailConnection.findUnique({
    where: { workspaceId: parsed.data.workspaceId },
    select: connectionSelect,
  });

  if (!connection) return c.json(null, 200);
  // encryptedRefreshToken is excluded by the select clause above and must never be returned.
  const { ...safe } = connection as typeof connection & { encryptedRefreshToken?: unknown };
  delete safe.encryptedRefreshToken;

  // sharedMailbox is cross-tenant on purpose: it must match the disconnect
  // service's revocation decision. alsoConnectedIn is scoped to the requesting
  // user's memberships — other tenants' workspace names must never leak.
  const userId = c.get("userId");
  const [siblingsCount, alsoConnectedIn] = await Promise.all([
    countActiveSiblingConnections(connection.gmailAddress, connection.workspaceId),
    listVisibleSiblingConnections(connection.gmailAddress, connection.workspaceId, userId),
  ]);

  return c.json({
    ...safe,
    sharedMailbox: siblingsCount > 0,
    alsoConnectedIn,
  });
});

// One-time auth code from a Google Sign-In. Mobile sends a serverAuthCode minted
// against the Web client directly (no redirect). The browser extension runs the
// code flow via chrome.identity and sends the chromiumapp.org redirectUri its
// code was minted for — the code must be redeemed against that exact redirect.
const connectBody = z.object({
  serverAuthCode: z.string().min(1),
  scope: z.string().min(1),
  redirectUri: z.string().min(1).optional(),
});

// Connect or reconnect Gmail for an existing workspace. Owner-only.
// The mobile app obtains a serverAuthCode; the API redeems it with the Web client.
gmailConnection.post("/workspaces/:workspaceId/gmail-connection", async (c) => {
  const parsed = workspaceParam.safeParse({ workspaceId: c.req.param("workspaceId") });
  if (!parsed.success) return c.json({ error: "Invalid workspace ID" }, 400);

  const { workspaceId } = parsed.data;
  const userId = c.get("userId");

  // Only the workspace owner may connect Gmail (mirrors the web connect flow).
  const workspace = await db.workspace.findFirst({
    where: { id: workspaceId, ownerUserId: userId },
    select: { id: true },
  });
  if (!workspace) return c.json({ error: "Not authorized" }, 403);

  const body = await c.req.json().catch(() => null);
  const bodyParsed = connectBody.safeParse(body);
  if (!bodyParsed.success) return c.json({ error: "Invalid request" }, 400);

  const { serverAuthCode, scope, redirectUri } = bodyParsed.data;
  // Early check on the client-claimed scope; the authoritative check is on the
  // scope Google returns from the exchange below.
  if (!parseGrantedScopes(scope).hasReadonly) {
    return c.json({ error: "Gmail read access was not granted" }, 403);
  }

  // Capture the inbox previously connected to this workspace (if any) so the
  // audit entry below can flag a ROTATION — connecting a different inbox than was
  // there before. The connect path was previously unaudited, leaving serial
  // inbox rotation (reusing one paid workspace across many inboxes) invisible.
  const priorConnection = await db.gmailConnection.findUnique({
    where: { workspaceId },
    select: { gmailAddress: true, status: true },
  });

  try {
    // Redeem the code with the confidential Web client, then store the
    // server-refreshable refresh token it returns. Extension codes carry the
    // chromiumapp.org redirect they were minted for; mobile server-auth codes
    // have none (redeemed against the webClientId directly). Mirrors /auth/google.
    const { accessToken, refreshToken, scope: grantedScope } = redirectUri
      ? await exchangeAuthCode(serverAuthCode, redirectUri)
      : await exchangeServerAuthCode(serverAuthCode);
    const { scopes: grantedScopes, hasReadonly } = parseGrantedScopes(grantedScope);
    if (!hasReadonly) {
      return c.json({ error: "Gmail read access was not granted" }, 403);
    }
    const { gmailAddress } = await storeGmailConnection({
      workspaceId,
      accessToken,
      refreshToken,
      grantedScopes,
    });

    // Audit the connect (best-effort; never blocks the response). `replacedAddress`
    // is set only when a DIFFERENT inbox was connected before — the rotation signal.
    const replacedAddress =
      priorConnection?.gmailAddress && priorConnection.gmailAddress !== gmailAddress
        ? priorConnection.gmailAddress
        : null;
    await recordAudit({
      workspaceId,
      actorType: "USER",
      actorUserId: userId,
      eventType: "gmail.connected",
      entityType: "GmailConnection",
      metadata: { gmailAddress, replacedAddress, priorStatus: priorConnection?.status ?? null },
    });
  } catch (err) {
    if (err instanceof GmailApiError) {
      // Code redemption or profile verification failed (expired/reused/invalid code).
      return c.json({ error: "Could not verify Gmail access" }, 502);
    }
    console.error("[gmail-connection/connect] store:", err instanceof Error ? err.message : err);
    return c.json({ error: "Could not store Gmail connection" }, 500);
  }

  // Fire-and-forget: immediate inbox sync. Same dedup id as /auth/google and
  // trigger-sync so a concurrent call does not double-queue.
  syncInboxQueue
    .add(
      "sync-inbox",
      { workspaceId },
      { deduplication: { id: `sync-inbox_${workspaceId}` } },
    )
    .catch((err) =>
      console.error(
        "[gmail-connection/connect] trigger_sync:",
        err instanceof Error ? err.message : err,
      ),
    );

  // Fire-and-forget: arm the Gmail push watch immediately so Pub/Sub is live
  // right after (re)connecting, matching the web callback. The worker's daily
  // renewal is the fallback; polling covers any gap before the watch lands.
  registerGmailWatch(workspaceId).catch((err) =>
    console.error(
      "[gmail-connection/connect] register_watch:",
      err instanceof Error ? err.message : err,
    ),
  );

  // Fire-and-forget: one-time "install the browser extension" nudge. No-op if
  // the user already has the extension (they may be connecting *through* it) or
  // was already nudged. Never blocks the connect response.
  maybeCreateExtensionNudge({ userId, workspaceId }).catch((err) =>
    console.error(
      "[gmail-connection/connect] extension_nudge:",
      err instanceof Error ? err.message : err,
    ),
  );

  // Return the full connection shape (same as GET) so the client can update state.
  const connection = await db.gmailConnection.findUnique({
    where: { workspaceId },
    select: connectionSelect,
  });
  if (!connection) return c.json({ error: "Connection not found" }, 500);

  const [siblingsCount, alsoConnectedIn] = await Promise.all([
    countActiveSiblingConnections(connection.gmailAddress, connection.workspaceId),
    listVisibleSiblingConnections(connection.gmailAddress, connection.workspaceId, userId),
  ]);

  return c.json({ ...connection, sharedMailbox: siblingsCount > 0, alsoConnectedIn }, 201);
});

gmailConnection.delete("/workspaces/:workspaceId/gmail-connection", async (c) => {
  const parsed = workspaceParam.safeParse({ workspaceId: c.req.param("workspaceId") });
  if (!parsed.success) return c.json({ error: "Invalid workspace ID" }, 400);

  const { workspaceId } = parsed.data;

  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true },
  });
  if (!workspace) return c.json({ error: "Workspace not found" }, 404);

  const existing = await db.gmailConnection.findUnique({
    where: { workspaceId },
    select: { id: true },
  });
  if (!existing) return c.json({ error: "No Gmail connection found" }, 404);

  const eraseData = c.req.query("eraseData") === "true";
  const actorUserId = c.get("userId");

  const result = await disconnectGmail(workspaceId, { eraseData, actorUserId });
  return c.json(result);
});

export { gmailConnection as gmailConnectionRoute };
