import { db } from "./client.js";
import { createNotificationsForWorkspaceMembers } from "./notifications.js";

// Auth-failure disconnect transition. When a background job hits an
// unrecoverable Gmail auth error, the connection is flipped ACTIVE → DISCONNECTED
// and every workspace member is notified that triage has stopped. This lives in
// one place so the two worker call sites (classify-thread, sync-inbox) share the
// same atomic guard and side effects, rather than each updating the row inline.
//
// This is only for *automatic* disconnects. Explicit user-initiated disconnects
// go through the API service and deliberately do not notify (the user did it).

/**
 * Flip a workspace's Gmail connection from ACTIVE to DISCONNECTED because a job
 * hit an unrecoverable auth error, notifying all members on the winning flip.
 *
 * The conditional `updateMany` (WHERE status = ACTIVE) is the atomic claim: two
 * concurrent jobs both failing auth on the same connection race here, and only
 * the one that actually flips the row (count === 1) fans out notifications and
 * audits — the loser is a no-op. `GmailConnectionStatus` is exactly
 * ACTIVE | DISCONNECTED, so this is a complete dedup guard.
 *
 * Returns whether this call performed the flip, so the caller can enqueue the
 * matching push job exactly once (the push emitter lives in the worker; the db
 * package must not depend on the queue package).
 *
 * Best-effort: callers must not fail their critical path if it throws.
 */
export async function markGmailConnectionAuthFailed(workspaceId: string): Promise<boolean> {
  const flipped = await db.gmailConnection.updateMany({
    where: { workspaceId, status: "ACTIVE" },
    data: { status: "DISCONNECTED" },
  });
  if (flipped.count === 0) return false;

  const connection = await db.gmailConnection.findUnique({
    where: { workspaceId },
    select: { gmailAddress: true },
  });

  await createNotificationsForWorkspaceMembers({
    workspaceId,
    type: "gmail_disconnected",
    params: { gmailAddress: connection?.gmailAddress ?? "" },
  });

  await db.auditLog
    .create({
      data: {
        workspaceId,
        actorType: "SYSTEM",
        eventType: "gmail.auto_disconnected",
        metadata: { gmailAddress: connection?.gmailAddress ?? null },
      },
    })
    .catch(() => {});

  return true;
}
