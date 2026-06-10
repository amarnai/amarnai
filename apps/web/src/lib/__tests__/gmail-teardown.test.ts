import { vi, describe, it, expect, beforeEach } from "vitest";

const mockDisconnectGmail = vi.hoisted(() => vi.fn());

vi.mock("@amarnai/db", () => ({
  db: {
    gmailConnection: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/api", () => ({
  apiFor: vi.fn(() => ({ disconnectGmail: mockDisconnectGmail })),
}));

import { db } from "@amarnai/db";
import { apiFor } from "@/lib/api";
import { disconnectGmailBeforeDeletion } from "@/lib/gmail-teardown";

const USER_ID = "user-1";

beforeEach(() => {
  vi.clearAllMocks();
  mockDisconnectGmail.mockResolvedValue({ ok: true });
});

describe("disconnectGmailBeforeDeletion", () => {
  it("does nothing when no workspace IDs are given", async () => {
    await disconnectGmailBeforeDeletion(USER_ID, []);

    expect(db.gmailConnection.findMany).not.toHaveBeenCalled();
    expect(mockDisconnectGmail).not.toHaveBeenCalled();
  });

  it("does not call the API when no connections exist", async () => {
    vi.mocked(db.gmailConnection.findMany).mockResolvedValue([]);

    await disconnectGmailBeforeDeletion(USER_ID, ["ws-1", "ws-2"]);

    expect(mockDisconnectGmail).not.toHaveBeenCalled();
  });

  it("disconnects every connection without erasing data", async () => {
    vi.mocked(db.gmailConnection.findMany).mockResolvedValue([
      { workspaceId: "ws-1" },
      { workspaceId: "ws-2" },
    ] as never);

    await disconnectGmailBeforeDeletion(USER_ID, ["ws-1", "ws-2", "ws-3"]);

    expect(apiFor).toHaveBeenCalledWith(USER_ID);
    expect(mockDisconnectGmail).toHaveBeenCalledTimes(2);
    expect(mockDisconnectGmail).toHaveBeenCalledWith("ws-1", false);
    expect(mockDisconnectGmail).toHaveBeenCalledWith("ws-2", false);
  });

  it("only queries connections for the given workspace IDs", async () => {
    vi.mocked(db.gmailConnection.findMany).mockResolvedValue([]);

    await disconnectGmailBeforeDeletion(USER_ID, ["ws-1"]);

    expect(db.gmailConnection.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: { in: ["ws-1"] } },
      })
    );
  });

  it("continues with remaining workspaces when one disconnect fails", async () => {
    vi.mocked(db.gmailConnection.findMany).mockResolvedValue([
      { workspaceId: "ws-1" },
      { workspaceId: "ws-2" },
    ] as never);
    mockDisconnectGmail
      .mockRejectedValueOnce(new Error("API unavailable"))
      .mockResolvedValueOnce({ ok: true });

    await expect(
      disconnectGmailBeforeDeletion(USER_ID, ["ws-1", "ws-2"])
    ).resolves.toBeUndefined();

    expect(mockDisconnectGmail).toHaveBeenCalledTimes(2);
    expect(mockDisconnectGmail).toHaveBeenLastCalledWith("ws-2", false);
  });

  it("disconnects sequentially, not in parallel (shared-mailbox guard depends on it)", async () => {
    vi.mocked(db.gmailConnection.findMany).mockResolvedValue([
      { workspaceId: "ws-1" },
      { workspaceId: "ws-2" },
    ] as never);

    const events: string[] = [];
    mockDisconnectGmail.mockImplementation(async (workspaceId: string) => {
      events.push(`start-${workspaceId}`);
      await new Promise((resolve) => setTimeout(resolve, 0));
      events.push(`end-${workspaceId}`);
      return { ok: true };
    });

    await disconnectGmailBeforeDeletion(USER_ID, ["ws-1", "ws-2"]);

    expect(events).toEqual(["start-ws-1", "end-ws-1", "start-ws-2", "end-ws-2"]);
  });
});
