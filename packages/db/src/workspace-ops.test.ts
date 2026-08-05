import { vi, describe, it, expect, beforeEach } from "vitest";

// deleteUserCascade builds an array of Prisma operations and hands it to
// $transaction. We mock the client so we can assert which operations were queued
// (in particular, that a reset-immune TrialClaim is written when the user consumed
// a trial, and never when they did not).
vi.mock("./client", () => {
  const del = () => ({ deleteMany: vi.fn().mockReturnValue({}) });
  return {
    db: {
      user: { findUnique: vi.fn(), delete: vi.fn().mockReturnValue({}) },
      workspace: { findMany: vi.fn(), deleteMany: vi.fn().mockReturnValue({}) },
      trialClaim: { upsert: vi.fn().mockReturnValue({}) },
      draft: del(),
      threadSummary: del(),
      threadComment: del(),
      threadCommentRead: del(),
      emailTag: del(),
      emailClassification: del(),
      auditLog: del(),
      taxonomyGenerationState: del(),
      taxonomyEdge: del(),
      taxonomyNode: del(),
      taxonomyNodeReference: del(),
      tag: del(),
      emailMessage: del(),
      providerSyncState: del(),
      emailAddressIdentity: del(),
      emailThread: del(),
      emailAccount: {
        deleteMany: vi.fn().mockReturnValue({}),
        delete: vi.fn().mockReturnValue({}),
        findMany: vi.fn(),
      },
      emailConnection: del(),
      gmailSyncSettings: del(),
      workspaceInvitation: del(),
      workspaceMember: del(),
      verificationToken: del(),
      userCredential: del(),
      $transaction: vi.fn(),
    },
  };
});

vi.mock("./inbox", () => ({ ensureInboxTaxonomy: vi.fn() }));

import { db } from "./client";
import {
  deleteUserCascade,
  eraseEmailAccountData,
  eraseStaleEmailAccounts,
} from "./workspace-ops";

const USER_ID = "user-1";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.workspace.findMany).mockResolvedValue([{ id: "ws-1" }] as never);
  vi.mocked(db.$transaction).mockResolvedValue([] as never);
});

describe("deleteUserCascade", () => {
  it("writes a reset-immune TrialClaim when the deleted user had consumed a trial", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({
      email: "user@example.com",
      trialUsed: true,
    } as never);

    await deleteUserCascade(USER_ID);

    expect(db.trialClaim.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ userId: USER_ID }),
        update: {},
      })
    );
    expect(db.$transaction).toHaveBeenCalledOnce();
  });

  it("does not write a TrialClaim when the user never consumed a trial", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({
      email: "user@example.com",
      trialUsed: false,
    } as never);

    await deleteUserCascade(USER_ID);

    expect(db.trialClaim.upsert).not.toHaveBeenCalled();
    expect(db.$transaction).toHaveBeenCalledOnce();
  });

  it("removes the user's comments and read markers, including in workspaces they do not own", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({
      email: "user@example.com",
      trialUsed: false,
    } as never);

    await deleteUserCascade(USER_ID);

    // The second OR arm is what clears the author/user FKs in OTHER people's
    // workspaces before user.delete; without it the delete hits FK violations
    // and comments by a deleted user would linger (GDPR posture says they must
    // not).
    expect(db.threadComment.deleteMany).toHaveBeenCalledWith({
      where: { OR: [{ workspaceId: { in: ["ws-1"] } }, { authorUserId: USER_ID }] },
    });
    expect(db.threadCommentRead.deleteMany).toHaveBeenCalledWith({
      where: { OR: [{ workspaceId: { in: ["ws-1"] } }, { userId: USER_ID }] },
    });
  });

  it("is a no-op when the user is already gone (idempotent under retry)", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(null);

    await deleteUserCascade(USER_ID);

    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.trialClaim.upsert).not.toHaveBeenCalled();
  });
});

describe("eraseEmailAccountData", () => {
  it("deletes the account's data and the account row in one transaction, keeping taxonomy", async () => {
    await eraseEmailAccountData("acct-1");

    expect(db.$transaction).toHaveBeenCalledOnce();
    expect(db.emailAccount.delete).toHaveBeenCalledWith({ where: { id: "acct-1" } });
    // Thread-scoped children go with the threads, including comments.
    expect(db.threadComment.deleteMany).toHaveBeenCalledWith({
      where: { emailThread: { emailAccountId: "acct-1" } },
    });
    expect(db.threadCommentRead.deleteMany).toHaveBeenCalledWith({
      where: { emailThread: { emailAccountId: "acct-1" } },
    });
    // Workspace-level data must NOT be touched by an account-scoped erase.
    expect(db.taxonomyNode.deleteMany).not.toHaveBeenCalled();
    expect(db.taxonomyEdge.deleteMany).not.toHaveBeenCalled();
    expect(db.gmailSyncSettings.deleteMany).not.toHaveBeenCalled();
    expect(db.emailConnection.deleteMany).not.toHaveBeenCalled();
  });
});

describe("eraseStaleEmailAccounts", () => {
  it("erases every account except the one now connected and returns their addresses", async () => {
    vi.mocked(db.emailAccount.findMany).mockResolvedValue([
      { id: "acct-old-1", primaryEmailAddress: "old1@gmail.com" },
      { id: "acct-old-2", primaryEmailAddress: "old2@outlook.com" },
    ] as never);

    const erased = await eraseStaleEmailAccounts("ws-1", "kept@outlook.com");

    // Filters by workspace, excluding the kept provider account id.
    expect(db.emailAccount.findMany).toHaveBeenCalledWith({
      where: { workspaceId: "ws-1", providerAccountId: { not: "kept@outlook.com" } },
      select: { id: true, primaryEmailAddress: true },
    });
    // One erase transaction per stale account.
    expect(db.$transaction).toHaveBeenCalledTimes(2);
    expect(db.emailAccount.delete).toHaveBeenCalledWith({ where: { id: "acct-old-1" } });
    expect(db.emailAccount.delete).toHaveBeenCalledWith({ where: { id: "acct-old-2" } });
    expect(erased).toEqual(["old1@gmail.com", "old2@outlook.com"]);
  });

  it("does nothing when the connected inbox is the only account (same-mailbox reconnect)", async () => {
    vi.mocked(db.emailAccount.findMany).mockResolvedValue([] as never);

    const erased = await eraseStaleEmailAccounts("ws-1", "kept@gmail.com");

    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.emailAccount.delete).not.toHaveBeenCalled();
    expect(erased).toEqual([]);
  });
});
