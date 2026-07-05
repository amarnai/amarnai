import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("./client", () => ({
  db: {
    extensionInstall: { findUnique: vi.fn() },
    user: { updateMany: vi.fn() },
    notification: { create: vi.fn(), deleteMany: vi.fn() },
  },
}));

import { db } from "./client";
import { maybeCreateExtensionNudge, deleteExtensionNudgeNotifications } from "./notifications";

const input = { userId: "u1", workspaceId: "ws1" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.notification.create).mockResolvedValue({} as never);
  vi.mocked(db.notification.deleteMany).mockResolvedValue({ count: 0 } as never);
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
