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
      emailTag: del(),
      emailClassification: del(),
      auditLog: del(),
      taxonomyGenerationState: del(),
      taxonomyEdge: del(),
      taxonomyNode: del(),
      tag: del(),
      emailMessage: del(),
      providerSyncState: del(),
      emailAddressIdentity: del(),
      emailThread: del(),
      emailAccount: del(),
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
import { deleteUserCascade } from "./workspace-ops";

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

  it("is a no-op when the user is already gone (idempotent under retry)", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(null);

    await deleteUserCascade(USER_ID);

    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.trialClaim.upsert).not.toHaveBeenCalled();
  });
});
