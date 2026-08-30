import { Hono } from "hono";
import { z } from "zod";
import { db } from "@aziru/db";
import type { AppEnv } from "../env.js";

// In-app notification feed. These routes are USER-scoped, not workspace-scoped,
// so they live outside the /workspaces/:workspaceId/* guard. Tenancy is enforced
// directly by filtering on the authenticated user id (c.get("userId")); a caller
// can only ever read or mutate their own rows.

const listQuery = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  // When set, hide notifications the user has dealt with (dismissed). The bell
  // pop-up passes this to show only the "fresh" feed; the full notifications
  // page omits it and receives everything, dismissed rows included.
  undismissed: z
    .union([z.literal("1"), z.literal("true")])
    .optional()
    .transform((v) => v !== undefined),
});


const notifications = new Hono<AppEnv>();

// ─── GET /notifications ────────────────────────────────────────────────────────
// Most-recent-first feed for the current user, keyset-paginated by createdAt+id.

notifications.get("/notifications", async (c) => {
  const parsed = listQuery.safeParse({
    cursor: c.req.query("cursor"),
    limit: c.req.query("limit"),
    undismissed: c.req.query("undismissed"),
  });
  if (!parsed.success) return c.json({ error: "Invalid query" }, 400);

  const userId = c.get("userId");
  const limit = parsed.data.limit ?? 30;

  // Cursor is the createdAt ISO of the last row seen (id breaks ties).
  const cursor = parsed.data.cursor ? decodeCursor(parsed.data.cursor) : null;

  const rows = await db.notification.findMany({
    where: {
      userId,
      ...(parsed.data.undismissed ? { dismissedAt: null } : {}),
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { lt: cursor.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    select: {
      id: true,
      workspaceId: true,
      type: true,
      params: true,
      readAt: true,
      dismissedAt: true,
      createdAt: true,
    },
  });

  const hasNextPage = rows.length > limit;
  const page = hasNextPage ? rows.slice(0, limit) : rows;
  const last = page.at(-1);
  const nextCursor = hasNextPage && last
    ? encodeCursor({ createdAt: last.createdAt, id: last.id })
    : null;

  return c.json({
    notifications: page.map((n) => ({
      id: n.id,
      workspaceId: n.workspaceId,
      type: n.type,
      params: n.params,
      readAt: n.readAt ? n.readAt.toISOString() : null,
      dismissedAt: n.dismissedAt ? n.dismissedAt.toISOString() : null,
      createdAt: n.createdAt.toISOString(),
    })),
    nextCursor,
  });
});

// ─── GET /notifications/unread-count ───────────────────────────────────────────
// Drives the bell badge. Polled by the client.

notifications.get("/notifications/unread-count", async (c) => {
  const userId = c.get("userId");
  const count = await db.notification.count({
    where: { userId, readAt: null },
  });
  return c.json({ count });
});
// ─── POST /notifications/read-all ──────────────────────────────────────────────

notifications.post("/notifications/read-all", async (c) => {
  const userId = c.get("userId");
  const result = await db.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
  return c.json({ ok: true, updated: result.count });
});

// ─── POST /notifications/update ────────────────────────────────────────────────
// Batch mark read / unread. Handles a single id (array of one) or a selection.
// Scoped to the owner: foreign ids in the list simply match no rows. `read:true`
// stamps readAt; `read:false` clears it back to unread.

const updateInput = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
  read: z.boolean(),
});

notifications.post("/notifications/update", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = updateInput.safeParse(body);
  if (!parsed.success) return c.json({ error: "Invalid body" }, 400);

  const userId = c.get("userId");
  const { ids, read } = parsed.data;
  const result = await db.notification.updateMany({
    where: { id: { in: ids }, userId },
    data: { readAt: read ? new Date() : null },
  });
  return c.json({ ok: true, updated: result.count });
});

// ─── POST /notifications/dismiss ───────────────────────────────────────────────
// Mark notifications as dealt-with so they drop out of the bell pop-up feed. Does
// NOT delete them: dismissed rows still show on the full notifications page (the
// archive). Called when the user clicks a notification through to its thread or
// explicitly dismisses it from the pop-up. Dismissing also stamps readAt on any
// still-unread rows, since dealing with a notification implies having seen it —
// this keeps the badge and the pop-up consistent for notifications dismissed
// before the pop-up's mark-all-read runs (e.g. an informational item cleared via
// its dismiss control). Idempotent and owner-scoped: foreign ids match no rows.

const dismissInput = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
});

notifications.post("/notifications/dismiss", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = dismissInput.safeParse(body);
  if (!parsed.success) return c.json({ error: "Invalid body" }, 400);

  const userId = c.get("userId");
  const now = new Date();
  const result = await db.notification.updateMany({
    where: { id: { in: parsed.data.ids }, userId, dismissedAt: null },
    data: { dismissedAt: now },
  });
  // Seen-implies-read: stamp readAt on any of these rows still unread.
  await db.notification.updateMany({
    where: { id: { in: parsed.data.ids }, userId, readAt: null },
    data: { readAt: now },
  });
  return c.json({ ok: true, dismissed: result.count });
});

// ─── POST /notifications/delete ────────────────────────────────────────────────
// Batch delete. Handles a single id (array of one) or a selection. Scoped to the
// owner: foreign ids match no rows and are silently ignored.

const deleteInput = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
});

notifications.post("/notifications/delete", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = deleteInput.safeParse(body);
  if (!parsed.success) return c.json({ error: "Invalid body" }, 400);

  const userId = c.get("userId");
  const result = await db.notification.deleteMany({
    where: { id: { in: parsed.data.ids }, userId },
  });
  return c.json({ ok: true, deleted: result.count });
});

// ─── Cursor helpers ────────────────────────────────────────────────────────────

function encodeCursor(c: { createdAt: Date; id: string }): string {
  return Buffer.from(`${c.createdAt.toISOString()}|${c.id}`).toString("base64url");
}

function decodeCursor(raw: string): { createdAt: Date; id: string } | null {
  try {
    const [iso, id] = Buffer.from(raw, "base64url").toString("utf8").split("|");
    if (!iso || !id) return null;
    const createdAt = new Date(iso);
    if (Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

export { notifications as notificationsRoute };
