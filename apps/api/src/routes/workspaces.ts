import { Hono } from "hono";
import { db, resetWorkspaceData, deleteWorkspaceCascade, createFreeWorkspace, FreeWorkspaceLimitError } from "@amarnai/db";
import { isSupportedLocale, localeFromAcceptLanguage } from "@amarnai/i18n";
import type { AppEnv } from "../env.js";
import { disconnectGmail } from "../services/gmail-disconnect.js";

const workspaces = new Hono<AppEnv>();

const workspaceSelect = {
  id: true,
  name: true,
  locale: true,
  plan: true,
  createdAt: true,
  updatedAt: true,
  owner: {
    select: { id: true, email: true, name: true },
  },
  members: {
    select: {
      id: true,
      role: true,
      user: {
        select: { id: true, email: true, name: true },
      },
    },
  },
} as const;

// Only the workspace OWNER may rename, reset, or delete it. Returns the role so
// callers can distinguish "not a member" from "member but not owner".
async function ownerRole(workspaceId: string, userId: string): Promise<string | null> {
  const member = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: { role: true },
  });
  return member?.role ?? null;
}

workspaces.get("/workspaces", async (c) => {
  const userId = c.get("userId") as string | undefined;
  if (!userId) return c.json([]);

  const result = await db.workspace.findMany({
    where: {
      members: { some: { userId } },
    },
    select: workspaceSelect,
  });
  return c.json(result);
});

// Create — any authenticated user can create a new workspace, subject to the
// free-plan limit (one FREE workspace per user). Returns 409 if the limit is
// already reached; paid creation goes through the web Stripe flow.
workspaces.post("/workspaces", async (c) => {
  const userId = c.get("userId") as string | undefined;
  if (!userId) return c.json({ error: "Unauthorized" }, 401);

  const body = (await c.req.json().catch(() => null)) as { name?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return c.json({ error: "Workspace name cannot be empty" }, 400);
  if (name.length > 100) return c.json({ error: "Name must be 100 characters or fewer" }, 400);

  // Seed the workspace language from the creator's browser/device locale.
  const locale = localeFromAcceptLanguage(c.req.header("accept-language"));

  let workspaceId: string;
  try {
    workspaceId = await createFreeWorkspace(userId, name, locale);
  } catch (err) {
    if (err instanceof FreeWorkspaceLimitError) {
      return c.json({ error: err.message }, 409);
    }
    throw err;
  }

  const workspace = await db.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    select: workspaceSelect,
  });
  return c.json(workspace, 201);
});

// Update name and/or language — OWNER only. Mirrors the web settings action's
// validation/messages. The language drives both the UI and AI-generated
// taxonomy for everyone in the workspace, so only the owner may change it.
workspaces.patch("/workspaces/:workspaceId", async (c) => {
  const userId = c.get("userId") as string | undefined;
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  const workspaceId = c.req.param("workspaceId");

  const body = (await c.req.json().catch(() => null)) as
    | { name?: unknown; locale?: unknown }
    | null;

  const data: { name?: string; locale?: string } = {};

  if (body && "name" in body) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return c.json({ error: "Workspace name cannot be empty" }, 400);
    if (name.length > 100) return c.json({ error: "Name must be 100 characters or fewer" }, 400);
    data.name = name;
  }

  if (body && "locale" in body) {
    if (!isSupportedLocale(body.locale)) {
      return c.json({ error: "Unsupported locale" }, 400);
    }
    data.locale = body.locale;
  }

  if (Object.keys(data).length === 0) {
    return c.json({ error: "Nothing to update" }, 400);
  }

  if ((await ownerRole(workspaceId, userId)) !== "OWNER") {
    return c.json({ error: "Only admins can update the workspace" }, 403);
  }

  const updated = await db.workspace.update({
    where: { id: workspaceId },
    data,
    select: workspaceSelect,
  });
  return c.json(updated);
});

// Reset — OWNER only. Disconnects Gmail (best-effort) then wipes synced data and
// taxonomy, restoring Inbox. The workspace and its members are kept.
workspaces.post("/workspaces/:workspaceId/reset", async (c) => {
  const userId = c.get("userId") as string;
  const workspaceId = c.req.param("workspaceId");

  if ((await ownerRole(workspaceId, userId)) !== "OWNER") {
    return c.json({ error: "Only admins can reset the workspace" }, 403);
  }

  const connection = await db.gmailConnection.findUnique({
    where: { workspaceId },
    select: { id: true },
  });
  if (connection) {
    try {
      await disconnectGmail(workspaceId, { eraseData: true, actorUserId: userId });
    } catch (err) {
      console.warn(
        "[reset-workspace] Gmail disconnect failed (non-fatal):",
        err instanceof Error ? err.message : err,
      );
    }
  }

  await resetWorkspaceData(workspaceId);
  return c.json({ ok: true });
});

// Delete — OWNER only, and never the user's last owned workspace. Disconnects
// Gmail (best-effort) before the rows disappear, then cascades the deletion.
workspaces.delete("/workspaces/:workspaceId", async (c) => {
  const userId = c.get("userId") as string | undefined;
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  const workspaceId = c.req.param("workspaceId");

  if ((await ownerRole(workspaceId, userId)) !== "OWNER") {
    return c.json({ error: "Workspace not found or you are not the admin" }, 403);
  }

  const ownedCount = await db.workspace.count({ where: { ownerUserId: userId } });
  if (ownedCount <= 1) {
    return c.json({ error: "You cannot delete your only workspace" }, 409);
  }

  const connection = await db.gmailConnection.findUnique({
    where: { workspaceId },
    select: { id: true },
  });
  if (connection) {
    try {
      await disconnectGmail(workspaceId, { eraseData: false, actorUserId: userId });
    } catch (err) {
      console.warn(
        "[delete-workspace] Gmail disconnect failed (non-fatal):",
        err instanceof Error ? err.message : err,
      );
    }
  }

  await deleteWorkspaceCascade(workspaceId);
  return c.json({ ok: true });
});

export { workspaces as workspacesRoute };
