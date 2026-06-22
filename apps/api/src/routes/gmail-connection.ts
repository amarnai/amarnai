import { Hono } from "hono";
import { z } from "zod";
import { db } from "@amarnai/db";
import {
  parseGrantedScopes,
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

// Tokens produced by on-device exchange (Android public client + PKCE).
const connectBody = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  scope: z.string().min(1),
});

// Connect or reconnect Gmail for an existing workspace. Owner-only.
// The mobile app exchanges the auth code on-device and sends the resulting tokens.
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

  const { accessToken, refreshToken, scope } = bodyParsed.data;
  const { scopes: grantedScopes, hasReadonly } = parseGrantedScopes(scope);
  if (!hasReadonly) {
    return c.json({ error: "Gmail read access was not granted" }, 403);
  }

  try {
    await storeGmailConnection({
      workspaceId,
      accessToken,
      refreshToken,
      grantedScopes,
      // Tokens were minted on-device by the Android public OAuth client.
      oauthClient: "MOBILE",
    });
  } catch (err) {
    if (err instanceof GmailApiError) {
      return c.json({ error: "Could not verify Gmail profile" }, 502);
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
