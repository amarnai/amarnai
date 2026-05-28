import { Hono } from "hono";
import { z } from "zod";
import { db } from "@amarnai/db";
import { UpdateGmailSyncSettingsSchema, DEFAULT_GMAIL_SYNC_SETTINGS } from "@amarnai/shared";

const workspaceParam = z.object({ workspaceId: z.string().min(1) });

const gmailSyncSettings = new Hono();

/**
 * GET /workspaces/:workspaceId/gmail-sync-settings
 * Returns current settings, or defaults if no row exists yet.
 */
gmailSyncSettings.get("/workspaces/:workspaceId/gmail-sync-settings", async (c) => {
  const parsed = workspaceParam.safeParse({ workspaceId: c.req.param("workspaceId") });
  if (!parsed.success) return c.json({ error: "Invalid workspace ID" }, 400);

  const workspace = await db.workspace.findUnique({
    where: { id: parsed.data.workspaceId },
    select: { id: true },
  });
  if (!workspace) return c.json({ error: "Workspace not found" }, 404);

  const row = await db.gmailSyncSettings.findUnique({
    where: { workspaceId: parsed.data.workspaceId },
    select: { includeSpam: true, includePromotions: true, sortingPaused: true },
  });

  return c.json(row ?? DEFAULT_GMAIL_SYNC_SETTINGS);
});

/**
 * PATCH /workspaces/:workspaceId/gmail-sync-settings
 * Creates or updates settings. Returns the updated settings.
 */
gmailSyncSettings.patch("/workspaces/:workspaceId/gmail-sync-settings", async (c) => {
  const paramParsed = workspaceParam.safeParse({ workspaceId: c.req.param("workspaceId") });
  if (!paramParsed.success) return c.json({ error: "Invalid workspace ID" }, 400);

  const body = await c.req.json().catch(() => null);
  const bodyParsed = UpdateGmailSyncSettingsSchema.safeParse(body);
  if (!bodyParsed.success) {
    return c.json({ error: "Invalid request body", details: bodyParsed.error.issues }, 400);
  }

  const workspace = await db.workspace.findUnique({
    where: { id: paramParsed.data.workspaceId },
    select: { id: true },
  });
  if (!workspace) return c.json({ error: "Workspace not found" }, 404);

  // Build explicit update object — avoid spreading optional fields with exactOptionalPropertyTypes.
  const updateData: { includeSpam?: boolean; includePromotions?: boolean; sortingPaused?: boolean } = {};
  if (bodyParsed.data.includeSpam !== undefined) updateData.includeSpam = bodyParsed.data.includeSpam;
  if (bodyParsed.data.includePromotions !== undefined) updateData.includePromotions = bodyParsed.data.includePromotions;
  if (bodyParsed.data.sortingPaused !== undefined) updateData.sortingPaused = bodyParsed.data.sortingPaused;

  const updated = await db.gmailSyncSettings.upsert({
    where: { workspaceId: paramParsed.data.workspaceId },
    create: {
      workspaceId: paramParsed.data.workspaceId,
      includeSpam:       updateData.includeSpam       ?? DEFAULT_GMAIL_SYNC_SETTINGS.includeSpam,
      includePromotions: updateData.includePromotions ?? DEFAULT_GMAIL_SYNC_SETTINGS.includePromotions,
      sortingPaused:     updateData.sortingPaused     ?? DEFAULT_GMAIL_SYNC_SETTINGS.sortingPaused,
    },
    update: updateData,
    select: { includeSpam: true, includePromotions: true, sortingPaused: true },
  });

  return c.json(updated);
});

export { gmailSyncSettings as gmailSyncSettingsRoute };
