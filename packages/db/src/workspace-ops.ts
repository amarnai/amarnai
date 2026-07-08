import { db } from "./client.js";
import { ensureInboxTaxonomy } from "./inbox.js";
import { trialEmailKeyHash } from "./trial-claims.js";

export class FreeWorkspaceLimitError extends Error {
  constructor() {
    super("You already have a free workspace.");
    this.name = "FreeWorkspaceLimitError";
  }
}

// Create a FREE workspace owned by userId. Throws FreeWorkspaceLimitError if
// the user already owns one free workspace. Returns the new workspace id.
// `locale` seeds the workspace's language (UI + AI-generated taxonomy); callers
// pass the creator's resolved locale, defaulting to the source locale.
export async function createFreeWorkspace(
  userId: string,
  name: string,
  locale = "en",
): Promise<string> {
  const existingFree = await db.workspace.count({ where: { ownerUserId: userId, plan: "FREE" } });
  if (existingFree >= 1) throw new FreeWorkspaceLimitError();

  const workspace = await db.workspace.create({
    data: {
      name,
      ownerUserId: userId,
      locale,
      members: { create: { userId, role: "OWNER" } },
    },
    select: { id: true },
  });

  await ensureInboxTaxonomy(workspace.id);
  return workspace.id;
}

// Erase one EmailAccount's synced email data (threads, messages, drafts,
// classifications, tags, identities, sync cursor) and delete the account row,
// in FK-safe order within a single transaction. Workspace-level data —
// taxonomy, folders, sync settings, the EmailConnection — is intentionally
// kept: this scrubs a single mailbox, not the workspace. Idempotent under
// retry (deleteMany on already-removed rows is a no-op).
export async function eraseEmailAccountData(emailAccountId: string): Promise<void> {
  await db.$transaction([
    db.emailTag.deleteMany({
      where: {
        OR: [
          { emailThread: { emailAccountId } },
          { emailMessage: { emailAccountId } },
        ],
      },
    }),
    db.draft.deleteMany({ where: { emailThread: { emailAccountId } } }),
    db.emailClassification.deleteMany({ where: { emailThread: { emailAccountId } } }),
    db.emailMessage.deleteMany({ where: { emailAccountId } }),
    db.emailThread.deleteMany({ where: { emailAccountId } }),
    db.providerSyncState.deleteMany({ where: { emailAccountId } }),
    db.emailAddressIdentity.deleteMany({ where: { emailAccountId } }),
    db.emailAccount.delete({ where: { id: emailAccountId } }),
  ]);
}

// Inbox-rotation cleanup: erase every EmailAccount in the workspace whose
// providerAccountId does NOT match the newly connected inbox, keeping the
// workspace's taxonomy and settings intact. Because EmailAccount is keyed by
// (workspaceId, providerAccountId) and one workspace holds one connection at a
// time, connecting a different inbox (different address or provider) would
// otherwise leave the previous inbox's threads orphaned and spliced into the
// new inbox's view. Reconnecting the SAME inbox matches keepProviderAccountId,
// so its data is preserved. Returns the addresses that were erased (for audit).
//
// Safe to run in the OAuth callback before the sync worker (re)creates the new
// account: at that point only prior accounts exist, so nothing fresh is touched.
export async function eraseStaleEmailAccounts(
  workspaceId: string,
  keepProviderAccountId: string,
): Promise<string[]> {
  const stale = await db.emailAccount.findMany({
    where: { workspaceId, providerAccountId: { not: keepProviderAccountId } },
    select: { id: true, primaryEmailAddress: true },
  });
  for (const account of stale) {
    await eraseEmailAccountData(account.id);
  }
  return stale.map((a) => a.primaryEmailAddress);
}

// Workspace teardown cascades shared by the web server actions and the API
// routes, so the FK-safe delete order lives in exactly one place. Gmail
// disconnect (job cancellation + OAuth revoke) is orchestrated by the caller
// and must run BEFORE these, while the connection rows still exist.

// Wipe a workspace's Gmail connection, synced email data, and taxonomy, then
// restore the mandatory Inbox root + catch-all. The workspace, its members, and the owner's account
// are kept. deleteMany on already-removed rows is a no-op, so this is safe to
// run after a best-effort disconnect that may have removed some rows already.
export async function resetWorkspaceData(workspaceId: string): Promise<void> {
  await db.$transaction([
    db.draft.deleteMany({ where: { workspaceId } }),
    db.emailTag.deleteMany({
      where: {
        OR: [{ emailThread: { workspaceId } }, { emailMessage: { workspaceId } }],
      },
    }),
    db.emailClassification.deleteMany({ where: { workspaceId } }),
    db.taxonomyGenerationState.deleteMany({ where: { workspaceId } }),
    db.taxonomyEdge.deleteMany({ where: { workspaceId } }),
    db.taxonomyNode.deleteMany({ where: { workspaceId } }),
    db.emailMessage.deleteMany({ where: { workspaceId } }),
    db.providerSyncState.deleteMany({ where: { emailAccount: { workspaceId } } }),
    db.emailAddressIdentity.deleteMany({ where: { emailAccount: { workspaceId } } }),
    db.emailThread.deleteMany({ where: { workspaceId } }),
    db.emailAccount.deleteMany({ where: { workspaceId } }),
    db.gmailSyncSettings.deleteMany({ where: { workspaceId } }),
    db.emailConnection.deleteMany({ where: { workspaceId } }),
  ]);

  await ensureInboxTaxonomy(workspaceId);
}

// Permanently delete a user account and everything they own, in FK-safe order.
// Gmail disconnect (job cancellation + OAuth revoke) must be done by the caller
// BEFORE this runs, while the connection rows still exist.
export async function deleteUserCascade(userId: string): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { email: true, trialUsed: true },
  });
  // Already gone — nothing to do. Keeps the cascade idempotent under retry.
  if (!user) return;

  const workspaces = await db.workspace.findMany({
    where: { ownerUserId: userId },
    select: { id: true },
  });
  const workspaceIds = workspaces.map((w) => w.id);

  await db.$transaction([
    // Persist the consumed trial BEFORE the user row disappears, so re-registering
    // the same email cannot mint a fresh trial. Reset-immune (no FK). Defensive:
    // provisioning normally wrote this already; the empty update never clobbers an
    // existing claim's cardFingerprint/subscriptionId.
    ...(user.trialUsed
      ? [
          db.trialClaim.upsert({
            where: { emailKeyHash: trialEmailKeyHash(user.email) },
            create: { emailKeyHash: trialEmailKeyHash(user.email), userId },
            update: {},
          }),
        ]
      : []),
    db.draft.deleteMany({ where: { workspaceId: { in: workspaceIds } } }),
    db.emailTag.deleteMany({
      where: {
        OR: [
          { emailThread: { workspaceId: { in: workspaceIds } } },
          { emailMessage: { workspaceId: { in: workspaceIds } } },
        ],
      },
    }),
    db.emailClassification.deleteMany({ where: { workspaceId: { in: workspaceIds } } }),
    db.auditLog.deleteMany({ where: { actorUserId: userId } }),
    db.taxonomyGenerationState.deleteMany({ where: { workspaceId: { in: workspaceIds } } }),
    db.taxonomyEdge.deleteMany({ where: { workspaceId: { in: workspaceIds } } }),
    db.taxonomyNode.deleteMany({ where: { workspaceId: { in: workspaceIds } } }),
    db.tag.deleteMany({ where: { workspaceId: { in: workspaceIds } } }),
    db.emailMessage.deleteMany({ where: { workspaceId: { in: workspaceIds } } }),
    db.providerSyncState.deleteMany({ where: { emailAccount: { workspaceId: { in: workspaceIds } } } }),
    db.emailAddressIdentity.deleteMany({ where: { emailAccount: { workspaceId: { in: workspaceIds } } } }),
    db.emailThread.deleteMany({ where: { workspaceId: { in: workspaceIds } } }),
    db.emailAccount.deleteMany({ where: { userId } }),
    db.emailConnection.deleteMany({ where: { workspaceId: { in: workspaceIds } } }),
    db.gmailSyncSettings.deleteMany({ where: { workspaceId: { in: workspaceIds } } }),
    db.workspaceInvitation.deleteMany({ where: { workspaceId: { in: workspaceIds } } }),
    db.workspaceMember.deleteMany({ where: { userId } }),
    db.workspace.deleteMany({ where: { ownerUserId: userId } }),
    db.verificationToken.deleteMany({ where: { userId } }),
    db.userCredential.deleteMany({ where: { userId } }),
    db.user.delete({ where: { id: userId } }),
  ]);
}

// Permanently delete a workspace and every row that references it, in FK-safe
// order within one transaction.
export async function deleteWorkspaceCascade(workspaceId: string): Promise<void> {
  await db.$transaction([
    db.draft.deleteMany({ where: { workspaceId } }),
    db.emailTag.deleteMany({
      where: {
        OR: [{ emailThread: { workspaceId } }, { emailMessage: { workspaceId } }],
      },
    }),
    db.emailClassification.deleteMany({ where: { workspaceId } }),
    db.auditLog.deleteMany({ where: { workspaceId } }),
    db.taxonomyGenerationState.deleteMany({ where: { workspaceId } }),
    db.taxonomyEdge.deleteMany({ where: { workspaceId } }),
    db.taxonomyNode.deleteMany({ where: { workspaceId } }),
    db.tag.deleteMany({ where: { workspaceId } }),
    db.emailMessage.deleteMany({ where: { workspaceId } }),
    db.providerSyncState.deleteMany({ where: { emailAccount: { workspaceId } } }),
    db.emailAddressIdentity.deleteMany({ where: { emailAccount: { workspaceId } } }),
    db.emailThread.deleteMany({ where: { workspaceId } }),
    db.emailAccount.deleteMany({ where: { workspaceId } }),
    db.emailConnection.deleteMany({ where: { workspaceId } }),
    db.gmailSyncSettings.deleteMany({ where: { workspaceId } }),
    db.workspaceInvitation.deleteMany({ where: { workspaceId } }),
    db.workspaceMember.deleteMany({ where: { workspaceId } }),
    db.workspace.delete({ where: { id: workspaceId } }),
  ]);
}
