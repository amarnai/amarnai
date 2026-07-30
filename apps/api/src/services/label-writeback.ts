import { db } from "@amarnai/db";
import { DEFAULT_GMAIL_SYNC_SETTINGS } from "@amarnai/shared";
import { config } from "@amarnai/config";
import { providerHasWritebackScope } from "@amarnai/mail";
import { provisionLabelsQueue } from "../queues.js";

/**
 * Enabling folder→label writeback, in one place. Three surfaces need it and used
 * to reach it three ways: the settings PATCH (which owned the logic inline), the
 * web OAuth callback (which called that PATCH over HTTP), and the API's own
 * sign-in and connect routes (which did not do it at all, so a granted write
 * scope never provisioned anything).
 */

/**
 * Whether the workspace's connected mailbox holds the write scope needed for
 * label writeback. Provider-dispatched so the check stays single-sourced in each
 * provider package. Returns false when no ACTIVE connection exists.
 */
export async function connectionHasWritebackScope(workspaceId: string): Promise<boolean> {
  const connection = await db.emailConnection.findUnique({
    where: { workspaceId },
    select: { provider: true, status: true, grantedScopes: true },
  });
  if (!connection || connection.status !== "ACTIVE") return false;
  return providerHasWritebackScope(connection.provider, connection.grantedScopes);
}

/**
 * Enqueue the worker job that mirrors the taxonomy into the mailbox.
 *
 * `relabelThreads` additionally sweeps every classified thread so an existing
 * inbox catches up (threads sorted before enablement, or threads that lost labels
 * to an external deletion). The dedup ids are deliberately distinct so an
 * in-flight structural-only provision cannot coalesce away a relabel sweep.
 *
 * Never throws: the job is idempotent and re-enqueued by later classifications,
 * so a queue blip must not fail the sign-in, connect, or settings write that
 * triggered it.
 */
export async function enqueueFolderLabelProvisioning(
  workspaceId: string,
  opts: { relabelThreads: boolean },
): Promise<void> {
  const { relabelThreads } = opts;
  try {
    await provisionLabelsQueue.add(
      "provision-folder-labels",
      { workspaceId, relabelThreads },
      {
        deduplication: {
          id: relabelThreads ? `provision_relabel_${workspaceId}` : `provision_${workspaceId}`,
        },
      },
    );
    // Log the enqueue so a stale process (old payload without relabelThreads) is
    // diagnosable from the API console alone.
    console.log(
      `[label-writeback] enqueued folder provisioning${
        relabelThreads ? " + thread relabel sweep" : ""
      } (workspace=${workspaceId})`,
    );
  } catch (err) {
    console.error(`[label-writeback] provision enqueue failed (workspace=${workspaceId}):`, err);
  }
}

export type EnableWritebackResult = "enabled" | "flag_off" | "scope_missing" | "failed";

/**
 * Turn on label writeback for a mailbox that just granted the write scope, and
 * kick off provisioning. Called on every sign-in and connect, not only the first:
 * with writeback on by default there is no false→true flip to detect, and both
 * the upsert and the enqueue are idempotent.
 *
 * Gates on the STORED grantedScopes rather than a flag threaded down from the
 * caller, so "this mailbox can write" has one definition (shared with the
 * settings PATCH and the worker's own re-check) and callers need no new argument.
 *
 * NEVER THROWS. A failure here must not fail the sign-in that triggered it: the
 * scope is already stored, the user can flip the toggle in settings, and the next
 * classification provisions lazily. The result is returned for the caller to log.
 */
export async function enableLabelWritebackForGrant(opts: {
  workspaceId: string;
  /** Log prefix identifying the calling flow, e.g. "auth-google". */
  source: string;
}): Promise<EnableWritebackResult> {
  const { workspaceId, source } = opts;
  if (!config.mail.labelWritebackEnabled) return "flag_off";

  try {
    if (!(await connectionHasWritebackScope(workspaceId))) return "scope_missing";

    await db.gmailSyncSettings.upsert({
      where: { workspaceId },
      create: {
        ...DEFAULT_GMAIL_SYNC_SETTINGS,
        workspaceId,
        labelWritebackEnabled: true,
      },
      update: { labelWritebackEnabled: true },
      select: { workspaceId: true },
    });
  } catch (err) {
    console.error(
      `[${source}] writeback_enable failed (workspace=${workspaceId}):`,
      err instanceof Error ? err.message : err,
    );
    return "failed";
  }

  await enqueueFolderLabelProvisioning(workspaceId, { relabelThreads: true });
  return "enabled";
}
