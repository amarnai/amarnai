import { Hono } from "hono";
import { z } from "zod";
import { db } from "@amarnai/db";
import { UpdateGmailSyncSettingsSchema, AddBlacklistEmailSchema, DEFAULT_GMAIL_SYNC_SETTINGS } from "@amarnai/shared";

const workspaceParam = z.object({ workspaceId: z.string().min(1) });

const gmailSyncSettings = new Hono();

const SETTINGS_SELECT = {
  includeSpam: true,
  includePromotions: true,
  sortingPaused: true,
  blacklistedSenderEmails: true,
} as const;

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
    select: SETTINGS_SELECT,
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
    select: SETTINGS_SELECT,
  });

  return c.json(updated);
});

/**
 * POST /workspaces/:workspaceId/gmail-sync-settings/blacklist
 * Adds an email address to the sender blacklist.
 */
gmailSyncSettings.post("/workspaces/:workspaceId/gmail-sync-settings/blacklist", async (c) => {
  const paramParsed = workspaceParam.safeParse({ workspaceId: c.req.param("workspaceId") });
  if (!paramParsed.success) return c.json({ error: "Invalid workspace ID" }, 400);

  const body = await c.req.json().catch(() => null);
  const bodyParsed = AddBlacklistEmailSchema.safeParse(body);
  if (!bodyParsed.success) {
    return c.json({ error: "Invalid email address" }, 400);
  }

  const { workspaceId } = paramParsed.data;
  const email = bodyParsed.data.email.toLowerCase();

  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true },
  });
  if (!workspace) return c.json({ error: "Workspace not found" }, 404);

  const existing = await db.gmailSyncSettings.findUnique({
    where: { workspaceId },
    select: { blacklistedSenderEmails: true },
  });

  const current = existing?.blacklistedSenderEmails ?? [];
  if (current.includes(email)) {
    // Already blacklisted — return current settings idempotently.
    const row = await db.gmailSyncSettings.findUnique({ where: { workspaceId }, select: SETTINGS_SELECT });
    return c.json(row ?? DEFAULT_GMAIL_SYNC_SETTINGS);
  }

  const updated = await db.gmailSyncSettings.upsert({
    where: { workspaceId },
    create: {
      workspaceId,
      blacklistedSenderEmails: [email],
    },
    update: {
      blacklistedSenderEmails: { push: email },
    },
    select: SETTINGS_SELECT,
  });

  return c.json(updated);
});

/**
 * DELETE /workspaces/:workspaceId/gmail-sync-settings/blacklist/:email
 * Removes an email address from the sender blacklist.
 */
gmailSyncSettings.delete("/workspaces/:workspaceId/gmail-sync-settings/blacklist/:email", async (c) => {
  const paramParsed = workspaceParam.safeParse({ workspaceId: c.req.param("workspaceId") });
  if (!paramParsed.success) return c.json({ error: "Invalid workspace ID" }, 400);

  const { workspaceId } = paramParsed.data;
  const email = decodeURIComponent(c.req.param("email")).toLowerCase();

  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true },
  });
  if (!workspace) return c.json({ error: "Workspace not found" }, 404);

  const existing = await db.gmailSyncSettings.findUnique({
    where: { workspaceId },
    select: { blacklistedSenderEmails: true },
  });

  if (!existing) {
    return c.json(DEFAULT_GMAIL_SYNC_SETTINGS);
  }

  const updated = await db.gmailSyncSettings.update({
    where: { workspaceId },
    data: {
      blacklistedSenderEmails: existing.blacklistedSenderEmails.filter((e) => e !== email),
    },
    select: SETTINGS_SELECT,
  });

  return c.json(updated);
});

export { gmailSyncSettings as gmailSyncSettingsRoute };
