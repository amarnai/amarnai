import { Hono } from "hono";
import { z } from "zod";
import { db } from "@amarnai/db";
import type { AppEnv } from "../env.js";
import {
  disconnectGmail,
  countActiveSiblingConnections,
  listVisibleSiblingConnections,
} from "../services/gmail-disconnect.js";

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
