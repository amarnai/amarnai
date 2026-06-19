import { db } from "./client.js";
import { ensureInboxNode } from "./inbox.js";

export class FreeWorkspaceLimitError extends Error {
  constructor() {
    super("You already have a free workspace.");
    this.name = "FreeWorkspaceLimitError";
  }
}

// Create a FREE workspace owned by userId. Throws FreeWorkspaceLimitError if
// the user already owns one free workspace. Returns the new workspace id.
export async function createFreeWorkspace(userId: string, name: string): Promise<string> {
  const existingFree = await db.workspace.count({ where: { ownerUserId: userId, plan: "FREE" } });
  if (existingFree >= 1) throw new FreeWorkspaceLimitError();

  const workspace = await db.workspace.create({
    data: {
      name,
      ownerUserId: userId,
      members: { create: { userId, role: "OWNER" } },
    },
    select: { id: true },
  });

  await ensureInboxNode(workspace.id);
  return workspace.id;
}

// Workspace teardown cascades shared by the web server actions and the API
// routes, so the FK-safe delete order lives in exactly one place. Gmail
// disconnect (job cancellation + OAuth revoke) is orchestrated by the caller
// and must run BEFORE these, while the connection rows still exist.

// Wipe a workspace's Gmail connection, synced email data, and taxonomy, then
// restore the Inbox root. The workspace, its members, and the owner's account
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
    db.taxonomyEdge.deleteMany({ where: { workspaceId } }),
    db.taxonomyNode.deleteMany({ where: { workspaceId } }),
    db.emailMessage.deleteMany({ where: { workspaceId } }),
    db.providerSyncState.deleteMany({ where: { emailAccount: { workspaceId } } }),
    db.emailAddressIdentity.deleteMany({ where: { emailAccount: { workspaceId } } }),
    db.emailThread.deleteMany({ where: { workspaceId } }),
    db.emailAccount.deleteMany({ where: { workspaceId } }),
    db.gmailSyncSettings.deleteMany({ where: { workspaceId } }),
    db.gmailConnection.deleteMany({ where: { workspaceId } }),
  ]);

  await ensureInboxNode(workspaceId);
}

// Permanently delete a user account and everything they own, in FK-safe order.
// Gmail disconnect (job cancellation + OAuth revoke) must be done by the caller
// BEFORE this runs, while the connection rows still exist.
export async function deleteUserCascade(userId: string): Promise<void> {
  const workspaces = await db.workspace.findMany({
    where: { ownerUserId: userId },
    select: { id: true },
  });
  const workspaceIds = workspaces.map((w) => w.id);

  await db.$transaction([
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
    db.taxonomyEdge.deleteMany({ where: { workspaceId: { in: workspaceIds } } }),
    db.taxonomyNode.deleteMany({ where: { workspaceId: { in: workspaceIds } } }),
    db.tag.deleteMany({ where: { workspaceId: { in: workspaceIds } } }),
    db.emailMessage.deleteMany({ where: { workspaceId: { in: workspaceIds } } }),
    db.providerSyncState.deleteMany({ where: { emailAccount: { workspaceId: { in: workspaceIds } } } }),
    db.emailAddressIdentity.deleteMany({ where: { emailAccount: { workspaceId: { in: workspaceIds } } } }),
    db.emailThread.deleteMany({ where: { workspaceId: { in: workspaceIds } } }),
    db.emailAccount.deleteMany({ where: { userId } }),
    db.gmailConnection.deleteMany({ where: { workspaceId: { in: workspaceIds } } }),
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
    db.taxonomyEdge.deleteMany({ where: { workspaceId } }),
    db.taxonomyNode.deleteMany({ where: { workspaceId } }),
    db.tag.deleteMany({ where: { workspaceId } }),
    db.emailMessage.deleteMany({ where: { workspaceId } }),
    db.providerSyncState.deleteMany({ where: { emailAccount: { workspaceId } } }),
    db.emailAddressIdentity.deleteMany({ where: { emailAccount: { workspaceId } } }),
    db.emailThread.deleteMany({ where: { workspaceId } }),
    db.emailAccount.deleteMany({ where: { workspaceId } }),
    db.gmailConnection.deleteMany({ where: { workspaceId } }),
    db.gmailSyncSettings.deleteMany({ where: { workspaceId } }),
    db.workspaceInvitation.deleteMany({ where: { workspaceId } }),
    db.workspaceMember.deleteMany({ where: { workspaceId } }),
    db.workspace.delete({ where: { id: workspaceId } }),
  ]);
}
