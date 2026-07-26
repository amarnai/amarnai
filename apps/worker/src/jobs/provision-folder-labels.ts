import { Worker } from "bullmq";
import { db, markGmailConnectionAuthFailed } from "@amarnai/db";
import { config } from "@amarnai/config";
import { DEFAULT_GMAIL_SYNC_SETTINGS } from "@amarnai/shared";
import { createMailProvider, MailAuthError, providerHasWritebackScope, type MailFolderLabelDef } from "@amarnai/mail";
import { buildProviderPaths, resolveFolderColorKey } from "@amarnai/core";
import {
  QUEUE_PROVISION_LABELS,
  type ProvisionLabelsJobData,
} from "../queues.js";
import { redisConnection } from "../redis.js";
import { pushNotificationQueue } from "../queues.js";

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
 * recording the provider-side identifier per node. Idempotent: existing
 * labels/categories are reused, nodes already provisioned at their current path
 * are skipped, and links for a rotated-out mailbox are cleared first. Shared by
 * the provision job and lazily by the per-thread writeback job when a link is
 * missing. Returns the number of nodes (re)provisioned. Throws MailAuthError on
 * a dead token so the caller can flip the connection to DISCONNECTED.
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

  const [nodes, edges, links] = await Promise.all([
    db.taxonomyNode.findMany({
      where: { workspaceId },
      select: { id: true, name: true, isRoot: true, isCatchAll: true, colorKey: true },
    }),
    db.taxonomyEdge.findMany({
      where: { workspaceId },
      select: { id: true, sourceNodeId: true, targetNodeId: true, createdAt: true },
    }),
    db.taxonomyNodeProviderLink.findMany({
      where: { workspaceId, provider: connection.provider, mailboxKey: connection.mailboxKey },
      select: { nodeId: true, providerPath: true },
    }),
  ]);

  const paths = buildProviderPaths(nodes, edges);
  const existingPathByNode = new Map(links.map((l) => [l.nodeId, l.providerPath]));

  const defs: MailFolderLabelDef[] = [];
  for (const node of nodes) {
    const segments = paths.get(node.id);
    if (!segments) continue; // root nodes carry no label
    const providerPath = segments.join("/");
    // Already provisioned at exactly this path — nothing to (re)create.
    if (existingPathByNode.get(node.id) === providerPath) continue;
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
 * provision-folder-labels worker: (re)mirror a workspace's taxonomy into its
 * mailbox. Enqueued when writeback is enabled or the taxonomy gains a folder.
 * TODO(writeback): rename/delete cascade — compare link.providerPath to the
 * current path and patch/remove the provider-side label (deferred).
 */
export function createProvisionFolderLabelsWorker(): Worker<ProvisionLabelsJobData> {
  return new Worker<ProvisionLabelsJobData>(
    QUEUE_PROVISION_LABELS,
    async (job) => {
      const { workspaceId } = job.data;
      const connection = await loadWritebackConnection(workspaceId);
      if (!connection) {
        console.log(`[provision-folder-labels] Writeback not active for workspace ${workspaceId} — skipping`);
        return;
      }
      try {
        const count = await provisionFolderLabels(workspaceId, connection);
        console.log(`[provision-folder-labels] workspace ${workspaceId}: provisioned ${count} folder(s)`);
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
