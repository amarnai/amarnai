import { db } from "@aziru/db";
import { apiFor } from "@/lib/api";

/**
 * Best-effort Gmail teardown for workspaces that are about to be deleted.
 *
 * For every Gmail connection in the given workspaces, calls the API's
 * disconnect endpoint, which cancels queued classify/sync/backfill jobs,
 * stops the Gmail push watch, and revokes the OAuth grant (skipping
 * Google-side teardown when another ACTIVE workspace shares the mailbox).
 *
 * Must run BEFORE the deletion transaction: the disconnect service needs the
 * GmailConnection row and the stored token to do its work.
 *
 * Failures never block deletion. A connection that could not be disconnected
 * leaves queued jobs behind, which exhaust their retries gracefully via the
 * workers' non-ACTIVE / missing-row guards.
 *
 * Callers must have already verified that `userId` owns every workspace in
 * `workspaceIds` — this function does not re-check ownership (the API's
 * membership middleware provides the backstop).
 */
export async function disconnectGmailBeforeDeletion(
  userId: string,
  workspaceIds: string[]
): Promise<void> {
  if (workspaceIds.length === 0) return;

  // Include DISCONNECTED rows: their queued jobs may not have been cancelled
  // (e.g. auth-failure disconnects), and the service is idempotent.
  const connections = await db.emailConnection.findMany({
    where: { workspaceId: { in: workspaceIds } },
    select: { workspaceId: true },
  });

  const api = apiFor(userId);

  // Sequential on purpose: the shared-mailbox guard counts other ACTIVE
  // connections at disconnect time. Running these in parallel could make two
  // workspaces sharing one mailbox each see the other as still ACTIVE, so
  // neither would revoke the OAuth grant.
  for (const { workspaceId } of connections) {
    try {
      await api.disconnectGmail(workspaceId, false);
    } catch (err) {
      console.warn(
        `[gmail-teardown] Disconnect failed for workspace ${workspaceId} (non-fatal):`,
        err instanceof Error ? err.message : err
      );
    }
  }
}
