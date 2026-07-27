import { Hono } from "hono";
import { z } from "zod";
import { db } from "@amarnai/db";
import { UpdateGmailSyncSettingsSchema, AddBlacklistEmailSchema, DEFAULT_GMAIL_SYNC_SETTINGS } from "@amarnai/shared";
import { config } from "@amarnai/config";
import { providerHasWritebackScope } from "@amarnai/mail";
import { provisionLabelsQueue } from "../queues.js";

const workspaceParam = z.object({ workspaceId: z.string().min(1) });

const gmailSyncSettings = new Hono();

const SETTINGS_SELECT = {
  includeSpam: true,
  includePromotions: true,
  sortingPaused: true,
  routeBulkToOther: true,
  labelWritebackEnabled: true,
  threadSummaryInjectionEnabled: true,
  replyButtonInjectionEnabled: true,
  blacklistedSenderEmails: true,
} as const;

/**
 * Whether the workspace's connected mailbox holds the write scope needed for
 * label writeback. Provider-dispatched so the check stays single-sourced in each
 * provider package. Returns false when no ACTIVE connection exists.
 */
async function connectionHasWritebackScope(workspaceId: string): Promise<boolean> {
  const connection = await db.emailConnection.findUnique({
    where: { workspaceId },
    select: { provider: true, status: true, grantedScopes: true },
  });
  if (!connection || connection.status !== "ACTIVE") return false;
  return providerHasWritebackScope(connection.provider, connection.grantedScopes);
}

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

  const { workspaceId } = paramParsed.data;
  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true },
  });
  if (!workspace) return c.json({ error: "Workspace not found" }, 404);

  // Enabling writeback is gated: the feature flag must be on AND the connected
  // mailbox must already hold the write scope (granted via incremental consent).
  // The settings UI routes users through consent first, so this only rejects a
  // direct/stale enable. Disabling is always allowed.
  const enablingWriteback = bodyParsed.data.labelWritebackEnabled === true;
  if (enablingWriteback) {
    if (!config.mail.labelWritebackEnabled) {
      return c.json({ error: "writeback_disabled" }, 409);
    }
    if (!(await connectionHasWritebackScope(workspaceId))) {
      return c.json({ error: "writeback_scope_missing" }, 409);
    }
  }

  const updateData: {
    includeSpam?: boolean;
    includePromotions?: boolean;
    sortingPaused?: boolean;
    routeBulkToOther?: boolean;
    labelWritebackEnabled?: boolean;
    threadSummaryInjectionEnabled?: boolean;
    replyButtonInjectionEnabled?: boolean;
  } = {};
  if (bodyParsed.data.includeSpam !== undefined) updateData.includeSpam = bodyParsed.data.includeSpam;
  if (bodyParsed.data.includePromotions !== undefined) updateData.includePromotions = bodyParsed.data.includePromotions;
  if (bodyParsed.data.sortingPaused !== undefined) updateData.sortingPaused = bodyParsed.data.sortingPaused;
  if (bodyParsed.data.routeBulkToOther !== undefined) updateData.routeBulkToOther = bodyParsed.data.routeBulkToOther;
  if (bodyParsed.data.labelWritebackEnabled !== undefined) updateData.labelWritebackEnabled = bodyParsed.data.labelWritebackEnabled;
  if (bodyParsed.data.threadSummaryInjectionEnabled !== undefined) updateData.threadSummaryInjectionEnabled = bodyParsed.data.threadSummaryInjectionEnabled;
  if (bodyParsed.data.replyButtonInjectionEnabled !== undefined) updateData.replyButtonInjectionEnabled = bodyParsed.data.replyButtonInjectionEnabled;

  const updated = await db.gmailSyncSettings.upsert({
    where: { workspaceId },
    create: {
      workspaceId,
      includeSpam:           updateData.includeSpam           ?? DEFAULT_GMAIL_SYNC_SETTINGS.includeSpam,
      includePromotions:     updateData.includePromotions     ?? DEFAULT_GMAIL_SYNC_SETTINGS.includePromotions,
      sortingPaused:         updateData.sortingPaused         ?? DEFAULT_GMAIL_SYNC_SETTINGS.sortingPaused,
      routeBulkToOther:      updateData.routeBulkToOther      ?? DEFAULT_GMAIL_SYNC_SETTINGS.routeBulkToOther,
      labelWritebackEnabled: updateData.labelWritebackEnabled ?? DEFAULT_GMAIL_SYNC_SETTINGS.labelWritebackEnabled,
      threadSummaryInjectionEnabled:
        updateData.threadSummaryInjectionEnabled ?? DEFAULT_GMAIL_SYNC_SETTINGS.threadSummaryInjectionEnabled,
      replyButtonInjectionEnabled:
        updateData.replyButtonInjectionEnabled ?? DEFAULT_GMAIL_SYNC_SETTINGS.replyButtonInjectionEnabled,
    },
    update: updateData,
    select: SETTINGS_SELECT,
  });

  // On any set-true (fresh connect enabling it, a re-enable, or a repeat), mirror
  // the current taxonomy into the mailbox AND sweep every classified thread so
  // the existing inbox catches up (threads sorted before enablement, or threads
  // that lost labels to an external deletion). Not gated on a false→true flip:
  // with writeback on by default there is no flip at connect time. Distinct
  // dedup id from the folder-create enqueues so an in-flight structural-only
  // provision cannot coalesce away the relabel sweep.
  if (enablingWriteback) {
    try {
      await provisionLabelsQueue.add(
        "provision-folder-labels",
        { workspaceId, relabelThreads: true },
        { deduplication: { id: `provision_relabel_${workspaceId}` } },
      );
      // Log the enqueue so a stale process (old payload without relabelThreads)
      // is diagnosable from the API console alone.
      console.log(
        `[gmail-sync-settings] enqueued folder provisioning + thread relabel sweep (workspace=${workspaceId})`,
      );
    } catch (err) {
      console.error(`[gmail-sync-settings] provision enqueue failed (workspace=${workspaceId}):`, err);
    }
  }

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
