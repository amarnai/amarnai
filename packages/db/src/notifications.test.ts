import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("./client", () => ({
  db: {
    extensionInstall: { findUnique: vi.fn() },
    user: { updateMany: vi.fn() },
    workspace: { updateMany: vi.fn(), findUnique: vi.fn() },
    workspaceMember: { findMany: vi.fn() },
    notification: { create: vi.fn(), deleteMany: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}));

import { db } from "./client";
import {
  maybeCreateExtensionNudge,
  deleteExtensionNudgeNotifications,
  createNotificationsForWorkspaceMembers,
  maybeCreateQuotaBlockedNotifications,
  deleteQuotaBlockedNotifications,
  deleteGmailDisconnectedNotifications,
} from "./notifications";

const input = { userId: "u1", workspaceId: "ws1" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.notification.create).mockResolvedValue({} as never);
  vi.mocked(db.notification.deleteMany).mockResolvedValue({ count: 0 } as never);
  vi.mocked(db.auditLog.create).mockResolvedValue({} as never);
});

describe("maybeCreateExtensionNudge", () => {
  it("creates the nudge and flips the marker when the user has no extension and was never nudged", async () => {
    vi.mocked(db.extensionInstall.findUnique).mockResolvedValue(null as never);
    vi.mocked(db.user.updateMany).mockResolvedValue({ count: 1 } as never);

    await maybeCreateExtensionNudge(input);

    // Marker flip is guarded on extensionNudgedAt being null.
    expect(db.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "u1", extensionNudgedAt: null },
        data: expect.objectContaining({ extensionNudgedAt: expect.any(Date) }),
      }),
    );
    expect(db.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "u1",
          workspaceId: "ws1",
          type: "extension_not_installed",
        }),
      }),
    );
  });

  it("is a no-op when the user already has the extension", async () => {
    vi.mocked(db.extensionInstall.findUnique).mockResolvedValue({ userId: "u1" } as never);

    await maybeCreateExtensionNudge(input);

    expect(db.user.updateMany).not.toHaveBeenCalled();
    expect(db.notification.create).not.toHaveBeenCalled();
  });

  it("does not create a second notification when the marker was already set (concurrent connect lost the race)", async () => {
    vi.mocked(db.extensionInstall.findUnique).mockResolvedValue(null as never);
    // updateMany matched no row: extensionNudgedAt was already non-null.
    vi.mocked(db.user.updateMany).mockResolvedValue({ count: 0 } as never);

    await maybeCreateExtensionNudge(input);

    expect(db.user.updateMany).toHaveBeenCalledOnce();
    expect(db.notification.create).not.toHaveBeenCalled();
  });
});

describe("deleteExtensionNudgeNotifications", () => {
  it("removes the user's extension_not_installed notifications", async () => {
    await deleteExtensionNudgeNotifications("u1");

    expect(db.notification.deleteMany).toHaveBeenCalledWith({
      where: { userId: "u1", type: "extension_not_installed" },
    });
  });
});

describe("createNotificationsForWorkspaceMembers", () => {
  it("creates one notification per workspace member", async () => {
    vi.mocked(db.workspaceMember.findMany).mockResolvedValue([
      { userId: "u1" },
      { userId: "u2" },
    ] as never);

    const count = await createNotificationsForWorkspaceMembers({
      workspaceId: "ws1",
      type: "backfill_complete",
      params: { processed: 5 },
    });

    expect(count).toBe(2);
    expect(db.notification.create).toHaveBeenCalledTimes(2);
    expect(db.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: "u1", workspaceId: "ws1", type: "backfill_complete" }),
      }),
    );
  });

  it("does not let one member's failed insert block the others", async () => {
    vi.mocked(db.workspaceMember.findMany).mockResolvedValue([
      { userId: "u1" },
      { userId: "u2" },
    ] as never);
    // First create rejects (u1), second resolves (u2).
    vi.mocked(db.notification.create)
      .mockRejectedValueOnce(new Error("boom") as never)
      .mockResolvedValueOnce({} as never);

    const count = await createNotificationsForWorkspaceMembers({
      workspaceId: "ws1",
      type: "backfill_complete",
    });

    expect(count).toBe(1);
    expect(db.notification.create).toHaveBeenCalledTimes(2);
  });
});

describe("maybeCreateQuotaBlockedNotifications", () => {
  const windowStart = new Date("2026-07-01T00:00:00.000Z");

  it("claims the window monotonically and fans out with the workspace plan", async () => {
    vi.mocked(db.workspace.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(db.workspace.findUnique).mockResolvedValue({ plan: "PRO" } as never);
    vi.mocked(db.workspaceMember.findMany).mockResolvedValue([{ userId: "u1" }] as never);

    await maybeCreateQuotaBlockedNotifications({ workspaceId: "ws1", windowStart });

    expect(db.workspace.updateMany).toHaveBeenCalledWith({
      where: {
        id: "ws1",
        OR: [
          { quotaNotifiedWindowStart: null },
          { quotaNotifiedWindowStart: { lt: windowStart } },
        ],
      },
      data: { quotaNotifiedWindowStart: windowStart },
    });
    expect(db.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "quota_blocked",
          params: { windowStart: windowStart.toISOString(), plan: "PRO" },
        }),
      }),
    );
  });

  it("is a no-op when the window was already claimed (lost the race)", async () => {
    vi.mocked(db.workspace.updateMany).mockResolvedValue({ count: 0 } as never);

    await maybeCreateQuotaBlockedNotifications({ workspaceId: "ws1", windowStart });

    expect(db.workspace.findUnique).not.toHaveBeenCalled();
    expect(db.notification.create).not.toHaveBeenCalled();
  });
});

describe("delete helpers", () => {
  it("deleteQuotaBlockedNotifications removes the workspace's quota_blocked rows", async () => {
    await deleteQuotaBlockedNotifications("ws1");
    expect(db.notification.deleteMany).toHaveBeenCalledWith({
      where: { workspaceId: "ws1", type: "quota_blocked" },
    });
  });

  it("deleteGmailDisconnectedNotifications removes the workspace's gmail_disconnected rows", async () => {
    await deleteGmailDisconnectedNotifications("ws1");
    expect(db.notification.deleteMany).toHaveBeenCalledWith({
      where: { workspaceId: "ws1", type: "gmail_disconnected" },
    });
  });
});
