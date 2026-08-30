import { Worker } from "bullmq";
import { db, markGmailConnectionAuthFailed } from "@aziru/db";
import { config } from "@aziru/config";
import { DEFAULT_GMAIL_SYNC_SETTINGS } from "@aziru/shared";
import { createMailProvider, MailAuthError, providerHasWritebackScope, type MailFolderLabelDef } from "@aziru/mail";
import { buildProviderPaths, resolveFolderColorKey } from "@aziru/core";
import { DEDUP_WRITEBACK } from "@aziru/queue";
import {
  QUEUE_PROVISION_LABELS,
  type ProvisionLabelsJobData,
} from "../queues.js";
import { redisConnection } from "../redis.js";
import { pushNotificationQueue, writebackThreadLabelQueue } from "../queues.js";

/**
 * The connection fields the writeback jobs need. Loaded once and passed around so
 * provisioning and per-thread reconcile share the same gate + mailbox-key logic.
 */
type WritebackConnection = {
  provider: "GMAIL" | "OUTLOOK";
  encryptedRefreshToken: string;
  grantedScopes: string[];
  mailboxKey: string;
};

/**
 * Load and gate the connection for label writeback. Returns null (a silent
 * no-op) when the feature flag is off, writeback is disabled for the workspace,
 * there is no ACTIVE connection, or the write scope was never granted. Every
 * writeback code path funnels through this so the gates stay in one place.
 */
export async function loadWritebackConnection(
  workspaceId: string,
): Promise<WritebackConnection | null> {
  if (!config.mail.labelWritebackEnabled) return null;

  // Writeback is on by default: a workspace with no settings row (never touched
  // any sync setting) gets the shared default, not "disabled".
  const settings = await db.gmailSyncSettings.findUnique({
    where: { workspaceId },
    select: { labelWritebackEnabled: true },
  });
  const enabled =
    settings?.labelWritebackEnabled ?? DEFAULT_GMAIL_SYNC_SETTINGS.labelWritebackEnabled;
  if (!enabled) return null;

  const connection = await db.emailConnection.findUnique({
    where: { workspaceId },
    select: {
      provider: true,
      status: true,
      grantedScopes: true,
      encryptedRefreshToken: true,
      emailAddress: true,
      subjectId: true,
    },
  });
  if (!connection || connection.status !== "ACTIVE") return null;
  if (!providerHasWritebackScope(connection.provider, connection.grantedScopes)) return null;

  return {
    provider: connection.provider,
    encryptedRefreshToken: connection.encryptedRefreshToken,
    grantedScopes: connection.grantedScopes,
    // Same derivation as the sync worker's inbox key; ties links to a mailbox.
    mailboxKey: connection.subjectId ?? connection.emailAddress,
  };
}

/**
 * Mirror every taxonomy folder into the connected mailbox as a label/category,
 * recording the provider-side identifier per node. ALWAYS verifies against the
 * provider rather than trusting stored links: the adapter lists what actually
 * exists and recreates anything missing, so a label/category the user deleted
 * provider-side is restored and its link refreshed (deleting labels in Gmail is
 * not how you turn the feature off — the settings switch is). Idempotent;
 * links for a rotated-out mailbox are cleared first. Shared by the provision
 * job and lazily by the per-thread writeback job (missing or stale link).
 * Returns the number of folders mirrored. Throws MailAuthError on a dead token
 * so the caller can flip the connection to DISCONNECTED.
 */
export async function provisionFolderLabels(
  workspaceId: string,
  connection: WritebackConnection,
): Promise<number> {
  // Inbox rotation self-heal: drop links that belong to a different mailbox than
  // the one now connected, so their stale identifiers are never reused.
  await db.taxonomyNodeProviderLink.deleteMany({
    where: { workspaceId, provider: connection.provider, NOT: { mailboxKey: connection.mailboxKey } },
  });

  const [nodes, edges] = await Promise.all([
    db.taxonomyNode.findMany({
      where: { workspaceId },
      select: { id: true, name: true, isRoot: true, isCatchAll: true, colorKey: true },
    }),
    db.taxonomyEdge.findMany({
      where: { workspaceId },
      select: { id: true, sourceNodeId: true, targetNodeId: true, createdAt: true },
    }),
  ]);

  const paths = buildProviderPaths(nodes, edges);

  // Every non-root node goes to the adapter — no "already provisioned" skip.
  // The adapter reuses existing labels/categories by name (one list call), so
  // the only writes are for genuinely missing ones; skipping on link rows here
  // is what previously made externally deleted labels unrecoverable.
  const defs: MailFolderLabelDef[] = [];
  for (const node of nodes) {
    const segments = paths.get(node.id);
    if (!segments) continue; // root nodes carry no label
    defs.push({
      nodeId: node.id,
      pathSegments: segments,
      colorKey: resolveFolderColorKey({ id: node.id, colorKey: node.colorKey }),
    });
  }

  if (defs.length === 0) return 0;

  const provider = createMailProvider(connection);
  const idByNode = await provider.ensureFolderLabels(defs);

  for (const def of defs) {
    const providerLabelId = idByNode.get(def.nodeId);
    if (!providerLabelId) continue;
    const providerPath = def.pathSegments.join("/");
    await db.taxonomyNodeProviderLink.upsert({
      where: { nodeId_provider: { nodeId: def.nodeId, provider: connection.provider } },
      create: {
        workspaceId,
        nodeId: def.nodeId,
        provider: connection.provider,
        mailboxKey: connection.mailboxKey,
        providerLabelId,
        providerPath,
      },
      update: {
        mailboxKey: connection.mailboxKey,
        providerLabelId,
        providerPath,
        provisionedAt: new Date(),
      },
    });
  }

  return defs.length;
}

/**
 * Fan out a writeback-thread-label job for every thread that has ever been
 * classified, so the whole inbox converges on the freshly provisioned labels.
 * The per-thread job is declarative and deduped, so this is safe to run over
 * threads that are already correct (each costs one provider read, no write).
 * TODO(writeback): compress with users.messages.batchModify / Graph $batch —
 * per-thread jobs are O(threads) provider calls (deferred; quota is ample at
 * current inbox sizes and the fan-out only runs on the enable toggle).
 */
async function relabelAllClassifiedThreads(workspaceId: string): Promise<number> {
  const classified = await db.emailClassification.findMany({
    where: { workspaceId },
    distinct: ["emailThreadId"],
    select: { emailThreadId: true },
  });

  const CHUNK = 500;
  for (let i = 0; i < classified.length; i += CHUNK) {
    await writebackThreadLabelQueue.addBulk(
      classified.slice(i, i + CHUNK).map(({ emailThreadId }) => ({
        name: "writeback-thread-label",
        data: { workspaceId, emailThreadId },
        opts: { deduplication: { id: `${DEDUP_WRITEBACK}_${workspaceId}_${emailThreadId}` } },
      })),
    );
  }
  return classified.length;
}

/**
 * provision-folder-labels worker: (re)mirror a workspace's taxonomy into its
 * mailbox. Enqueued when writeback is enabled or the taxonomy gains a folder;
 * the enable path additionally requests a full thread re-labeling sweep.
 * TODO(writeback): rename/delete cascade — compare link.providerPath to the
 * current path and patch/remove the provider-side label (deferred).
 */
export function createProvisionFolderLabelsWorker(): Worker<ProvisionLabelsJobData> {
  return new Worker<ProvisionLabelsJobData>(
    QUEUE_PROVISION_LABELS,
    async (job) => {
      const { workspaceId, relabelThreads } = job.data;
      const connection = await loadWritebackConnection(workspaceId);
      if (!connection) {
        console.log(`[provision-folder-labels] Writeback not active for workspace ${workspaceId} — skipping`);
        return;
      }
      try {
        const count = await provisionFolderLabels(workspaceId, connection);
        console.log(`[provision-folder-labels] workspace ${workspaceId}: provisioned ${count} folder(s)`);
        if (relabelThreads) {
          const threads = await relabelAllClassifiedThreads(workspaceId);
          console.log(
            `[provision-folder-labels] workspace ${workspaceId}: enqueued relabel for ${threads} thread(s)`,
          );
        }
      } catch (err) {
        if (err instanceof MailAuthError) {
          console.error(
            `[provision-folder-labels] auth failed for workspace ${workspaceId} — marking DISCONNECTED: ${err.message}`,
          );
          const flipped = await markGmailConnectionAuthFailed(workspaceId).catch(() => false);
          if (flipped) {
            await pushNotificationQueue
              .add("push-notification", { kind: "gmail_disconnected", workspaceId })
              .catch(() => {});
          }
          return; // handled — do not retry a dead token
        }
        throw err;
      }
    },
    { connection: redisConnection },
  );
}
