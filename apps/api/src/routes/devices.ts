import { Hono } from "hono";
import { db } from "@aziru/db";
import { RegisterPushDeviceSchema } from "@aziru/shared";
import type { AppEnv } from "../env.js";

const devices = new Hono<AppEnv>();

/**
 * POST /devices
 *
 * Registers (or refreshes) an Expo push token for the authenticated user. The
 * user is taken from the auth middleware (`userId` context var) — never from the
 * body — so a device is always bound to the caller's identity. There is no
 * workspaceId in the path: a device belongs to a user, and the worker fans a
 * workspace push out to every member's devices at emit time.
 *
 * Idempotent: keyed on the unique expoPushToken. Re-registering the same token
 * just bumps lastSeenAt. If a token previously belonged to a different user
 * (device handed over, account switch on the same install), ownership is
 * reassigned to the current caller so stale users never keep receiving pushes.
 */
devices.post("/devices", async (c) => {
  const userId = c.get("userId") as string | undefined;
  if (!userId) return c.json({ error: "Unauthorized" }, 401);

  const body = await c.req.json().catch(() => null);
  const parsed = RegisterPushDeviceSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request body", details: parsed.error.issues }, 400);
  }

  const { expoPushToken, platform } = parsed.data;

  // Read the current owner before upserting so we can detect a reassignment: a
  // token moving from one user to another. The legitimate case is device
  // handover / account switch on the same install, but it is also the shape of a
  // notification-hijack (registering someone else's token to silence their
  // pushes), so it is a security-relevant event worth a trail. One indexed read
  // on a cold path (registration happens at launch/login, not per request).
  const existing = await db.pushDevice.findUnique({
    where: { expoPushToken },
    select: { userId: true },
  });

  const device = await db.pushDevice.upsert({
    where: { expoPushToken },
    create: { userId, expoPushToken, platform },
    update: { userId, platform, lastSeenAt: new Date() },
    select: { id: true, platform: true, createdAt: true },
  });

  if (existing && existing.userId !== userId) {
    // Not written to AuditLog: that table is workspace-scoped, and a device is a
    // per-user resource with no natural workspace. A structured warn-level line
    // keeps this monitorable (log-based alerting) without misattributing it to a
    // workspace. Token values are never logged.
    console.warn(
      `[devices] Push token reassigned from user ${existing.userId} to user ${userId} (device ${device.id}, platform ${platform})`,
    );
  }

  return c.json({ ok: true, deviceId: device.id }, 201);
});

export { devices as devicesRoute };
