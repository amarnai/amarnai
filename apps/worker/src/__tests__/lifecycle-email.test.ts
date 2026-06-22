import { vi, describe, it, expect, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@amarnai/db", () => ({
  db: {
    user: { findUnique: vi.fn(), update: vi.fn().mockResolvedValue({}) },
    workspaceMember: { findMany: vi.fn() },
    emailThread: { groupBy: vi.fn() },
  },
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

    await expect(runLifecycleEmailJob("user-1")).rejects.toThrow("smtp down");
    expect(db.user.update).not.toHaveBeenCalled();
  });
});
