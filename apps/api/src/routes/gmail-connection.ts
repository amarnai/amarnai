import { Hono } from "hono";
import { z } from "zod";
import { db } from "@amarnai/db";

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

const gmailConnection = new Hono();

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
  return c.json(safe);
});

gmailConnection.delete("/workspaces/:workspaceId/gmail-connection", async (c) => {
  const parsed = workspaceParam.safeParse({ workspaceId: c.req.param("workspaceId") });
  if (!parsed.success) return c.json({ error: "Invalid workspace ID" }, 400);

  const workspace = await db.workspace.findUnique({
    where: { id: parsed.data.workspaceId },
    select: { id: true },
  });
  if (!workspace) return c.json({ error: "Workspace not found" }, 404);

  const existing = await db.gmailConnection.findUnique({
    where: { workspaceId: parsed.data.workspaceId },
    select: { id: true },
  });
  if (!existing) return c.json({ error: "No Gmail connection found" }, 404);

  await db.gmailConnection.delete({ where: { workspaceId: parsed.data.workspaceId } });
  return c.json({ ok: true });
});

export { gmailConnection as gmailConnectionRoute };
