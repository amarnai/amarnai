import { vi, describe, it, expect, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const { mockClaimIdempotencyToken, mockReleaseIdempotencyToken } = vi.hoisted(() => ({
  mockClaimIdempotencyToken: vi.fn(),
  mockReleaseIdempotencyToken: vi.fn(),
}));

vi.mock("@amarnai/db", () => ({
  db: {
    user: { findUnique: vi.fn(), update: vi.fn().mockResolvedValue({}) },
    workspaceMember: { findMany: vi.fn() },
    emailThread: { groupBy: vi.fn() },
  },
  claimIdempotencyToken: mockClaimIdempotencyToken,
  releaseIdempotencyToken: mockReleaseIdempotencyToken,
  lifecycleSendDedupToken: (k: string) => `LIFECYCLE_${k}`,
}));

vi.mock("@amarnai/email", () => ({
  sendLifecycleReminderEmail: vi.fn(async () => {}),
  appUrl: () => "https://app.test",
}));

vi.mock("@amarnai/auth/unsubscribe-token", () => ({ signUnsubscribeToken: () => "sig" }));

import { db } from "@amarnai/db";
import { sendLifecycleReminderEmail } from "@amarnai/email";
import { runLifecycleEmailJob, summarizeReportable } from "../jobs/lifecycle-email.js";

const mockedSend = vi.mocked(sendLifecycleReminderEmail);

beforeEach(() => {
  vi.clearAllMocks();
  // Default: the send-idempotency claim is won (first time this job runs).
  mockClaimIdempotencyToken.mockResolvedValue(true);
  mockReleaseIdempotencyToken.mockResolvedValue(undefined);
});

describe("summarizeReportable", () => {
  it("drops workspaces with nothing to report", () => {
    const result = summarizeReportable([
      { workspaceName: "A", needsReview: 0, pending: 0 },
      { workspaceName: "B", needsReview: 2, pending: 0 },
      { workspaceName: "C", needsReview: 0, pending: 4 },
    ]);
    expect(result.map((w) => w.workspaceName)).toEqual(["B", "C"]);
  });

  it("returns an empty list when nothing is actionable", () => {
    expect(summarizeReportable([{ workspaceName: "A", needsReview: 0, pending: 0 }])).toEqual([]);
  });
});

describe("runLifecycleEmailJob", () => {
  function verifiedUser() {
    vi.mocked(db.user.findUnique).mockResolvedValue({
      email: "u@x.com",
      name: "Ada",
      emailVerified: new Date(),
      lifecycleEmailsEnabled: true,
    } as never);
  }

  it("sends a digest and stamps the timestamp when there is something to report", async () => {
    verifiedUser();
    vi.mocked(db.workspaceMember.findMany).mockResolvedValue([
      { workspace: { id: "ws-1", name: "Acme" } },
    ] as never);
    vi.mocked(db.emailThread.groupBy).mockResolvedValue([
      { triageStatus: "NEEDS_REVIEW", _count: { _all: 3 } },
      { triageStatus: "PENDING", _count: { _all: 1 } },
    ] as never);

    await runLifecycleEmailJob("user-1");

    expect(mockedSend).toHaveBeenCalledTimes(1);
    expect(mockedSend.mock.calls[0]![1]).toMatchObject({
      workspaces: [{ workspaceName: "Acme", needsReview: 3, pending: 1 }],
    });
    expect(vi.mocked(db.user.update).mock.calls[0]![0]).toMatchObject({
      where: { id: "user-1" },
      data: { lifecycleEmailSentAt: expect.any(Date) },
    });
  });

  it("skips the send but still stamps when there is nothing to report", async () => {
    verifiedUser();
    vi.mocked(db.workspaceMember.findMany).mockResolvedValue([
      { workspace: { id: "ws-1", name: "Acme" } },
    ] as never);
    vi.mocked(db.emailThread.groupBy).mockResolvedValue([
      { triageStatus: "SORTED", _count: { _all: 10 } },
    ] as never);

    await runLifecycleEmailJob("user-1");

    expect(mockedSend).not.toHaveBeenCalled();
    expect(db.user.update).toHaveBeenCalledTimes(1); // cadence still advanced
  });

  it("skips entirely (no send, no stamp) for an opted-out user", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({
      email: "u@x.com",
      name: null,
      emailVerified: new Date(),
      lifecycleEmailsEnabled: false,
    } as never);

    await runLifecycleEmailJob("user-1");

    expect(mockedSend).not.toHaveBeenCalled();
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("skips entirely for an unverified user", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({
      email: "u@x.com",
      name: null,
      emailVerified: null,
      lifecycleEmailsEnabled: true,
    } as never);

    await runLifecycleEmailJob("user-1");

    expect(mockedSend).not.toHaveBeenCalled();
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("does not stamp when the send fails (so it retries next cycle)", async () => {
    verifiedUser();
    vi.mocked(db.workspaceMember.findMany).mockResolvedValue([
      { workspace: { id: "ws-1", name: "Acme" } },
    ] as never);
    vi.mocked(db.emailThread.groupBy).mockResolvedValue([
      { triageStatus: "NEEDS_REVIEW", _count: { _all: 1 } },
    ] as never);
    mockedSend.mockRejectedValueOnce(new Error("smtp down"));

    // Keyed path (production): a job id is present, so the send is claim-gated.
    await expect(runLifecycleEmailJob("user-1", "job-99")).rejects.toThrow("smtp down");
    expect(db.user.update).not.toHaveBeenCalled();
    // The claim is rolled back so BullMQ's retry (or the next tick) can re-send.
    expect(mockReleaseIdempotencyToken).toHaveBeenCalledTimes(1);
  });

  it("falls open to an unguarded send when no idempotency key is provided", async () => {
    verifiedUser();
    vi.mocked(db.workspaceMember.findMany).mockResolvedValue([
      { workspace: { id: "ws-1", name: "Acme" } },
    ] as never);
    vi.mocked(db.emailThread.groupBy).mockResolvedValue([
      { triageStatus: "NEEDS_REVIEW", _count: { _all: 1 } },
    ] as never);

    // No job id → no per-user-constant token is claimed (which would suppress every
    // future reminder). The send still goes out and the cadence is stamped.
    await runLifecycleEmailJob("user-1");

    expect(mockClaimIdempotencyToken).not.toHaveBeenCalled();
    expect(mockedSend).toHaveBeenCalledTimes(1);
    expect(mockedSend.mock.calls[0]![2]).toBeUndefined(); // no provider idempotency key
    expect(db.user.update).toHaveBeenCalledTimes(1);
  });

  it("claims a stable send token before sending and forwards it to the provider", async () => {
    verifiedUser();
    vi.mocked(db.workspaceMember.findMany).mockResolvedValue([
      { workspace: { id: "ws-1", name: "Acme" } },
    ] as never);
    vi.mocked(db.emailThread.groupBy).mockResolvedValue([
      { triageStatus: "NEEDS_REVIEW", _count: { _all: 2 } },
    ] as never);

    await runLifecycleEmailJob("user-1", "job-42");

    // Token is derived from the job's idempotency key, claimed before the send, and
    // handed to the provider (Resend idempotency key) as belt-and-suspenders.
    expect(mockClaimIdempotencyToken).toHaveBeenCalledWith("LIFECYCLE_job-42");
    expect(mockedSend.mock.calls[0]![2]).toEqual({ idempotencyKey: "LIFECYCLE_job-42" });
  });

  it("does NOT re-send when the send token was already claimed (retry after a committed send)", async () => {
    verifiedUser();
    vi.mocked(db.workspaceMember.findMany).mockResolvedValue([
      { workspace: { id: "ws-1", name: "Acme" } },
    ] as never);
    vi.mocked(db.emailThread.groupBy).mockResolvedValue([
      { triageStatus: "NEEDS_REVIEW", _count: { _all: 2 } },
    ] as never);
    // The prior attempt already sent and committed the claim; this retry loses it.
    mockClaimIdempotencyToken.mockResolvedValue(false);

    await runLifecycleEmailJob("user-1", "job-42");

    expect(mockedSend).not.toHaveBeenCalled(); // exactly one send across both attempts
    expect(mockReleaseIdempotencyToken).not.toHaveBeenCalled(); // nothing to roll back
    // Deliberately NOT stamped on the dedup path: if the prior attempt claimed then
    // crashed before sending, stamping here would suppress the user for a full week.
    // Leaving it unstamped keeps them eligible for the next daily tick.
    expect(db.user.update).not.toHaveBeenCalled();
  });
});
