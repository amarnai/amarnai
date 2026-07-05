import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("./client", () => ({
  db: {
    gmailConnection: { updateMany: vi.fn(), findUnique: vi.fn() },
    workspaceMember: { findMany: vi.fn() },
    notification: { create: vi.fn(), deleteMany: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}));

import { db } from "./client";
import { markGmailConnectionAuthFailed } from "./gmail-connection-status";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.notification.create).mockResolvedValue({} as never);
  vi.mocked(db.notification.deleteMany).mockResolvedValue({ count: 0 } as never);
  vi.mocked(db.auditLog.create).mockResolvedValue({} as never);
});

describe("markGmailConnectionAuthFailed", () => {
  it("flips ACTIVE→DISCONNECTED, notifies members, audits, and returns true on the winning flip", async () => {
    vi.mocked(db.gmailConnection.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(db.gmailConnection.findUnique).mockResolvedValue({ gmailAddress: "a@b.com" } as never);
    vi.mocked(db.workspaceMember.findMany).mockResolvedValue([{ userId: "u1" }] as never);

    const result = await markGmailConnectionAuthFailed("ws1");

    expect(result).toBe(true);
    // The flip is guarded on the current status being ACTIVE (atomic claim).
    expect(db.gmailConnection.updateMany).toHaveBeenCalledWith({
      where: { workspaceId: "ws1", status: "ACTIVE" },
      data: { status: "DISCONNECTED" },
    });
    expect(db.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "u1",
          type: "gmail_disconnected",
          params: { gmailAddress: "a@b.com" },
        }),
      }),
    );
    expect(db.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventType: "gmail.auto_disconnected" }),
      }),
    );
  });

  it("is a no-op and returns false when the connection was not ACTIVE (lost the race)", async () => {
    vi.mocked(db.gmailConnection.updateMany).mockResolvedValue({ count: 0 } as never);

    const result = await markGmailConnectionAuthFailed("ws1");

    expect(result).toBe(false);
    expect(db.gmailConnection.findUnique).not.toHaveBeenCalled();
    expect(db.notification.create).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });
});
