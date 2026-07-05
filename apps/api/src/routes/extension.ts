import { Hono } from "hono";
import { db, deleteExtensionNudgeNotifications } from "@amarnai/db";
import { RegisterExtensionSchema } from "@amarnai/shared";
import type { AppEnv } from "../env.js";

const extension = new Hono<AppEnv>();

/**
 * POST /extension/register
 *
 * The browser side-panel extension announces itself on panel load. The user is
 * taken from the auth middleware (`userId` context var) — never from the body —
 * so an install is always bound to the caller's identity. Registration is the
 * server-side "does this user have the extension?" signal; its presence
 * suppresses the install nudge.
 *
 * Idempotent: keyed on the unique userId, so re-registering (from either browser,
 * on every panel load) just refreshes browser/version/lastSeenAt.
 */
extension.post("/extension/register", async (c) => {
  const userId = c.get("userId") as string | undefined;
  if (!userId) return c.json({ error: "Unauthorized" }, 401);

  const body = await c.req.json().catch(() => null);
  const parsed = RegisterExtensionSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request body", details: parsed.error.issues }, 400);
  }

  const { browser, version } = parsed.data;

  await db.extensionInstall.upsert({
    where: { userId },
    create: { userId, browser, version },
    update: { browser, version, lastSeenAt: new Date() },
  });

  // They demonstrably have the extension now — clear any outstanding install
  // nudge so the bell item disappears. Best-effort; never fails the register.
  // The durable User.extensionNudgedAt marker is left set so it can't re-arm.
  await deleteExtensionNudgeNotifications(userId).catch((err) =>
    console.error(
      "[extension/register] clear_nudge:",
      err instanceof Error ? err.message : err,
    ),
  );

  return c.json({ ok: true }, 201);
});

export { extension as extensionRoute };
