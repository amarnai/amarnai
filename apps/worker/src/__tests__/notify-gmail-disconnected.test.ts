import { vi, describe, it, expect, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@amarnai/db", () => ({
  db: {
    emailConnection: { findUnique: vi.fn() },
    pushDevice: { findMany: vi.fn() },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  },
}));

import { db } from "@amarnai/db";
import { PUSH_CATEGORY_GMAIL_DISCONNECTED, PUSH_CHANNEL_TRIAGE } from "@amarnai/shared";
import { notifyGmailDisconnected } from "../notifications/notify-gmail-disconnected.js";
import type { PushBudgetStore } from "../notifications/notify-threads.js";
import type { ExpoPushMessage, ExpoPushTicket } from "../notifications/expo-push.js";

function makeStore(initial: Record<string, number> = {}): PushBudgetStore & { counts: Record<string, number> } {
  const counts: Record<string, number> = { ...initial };
  return {
    counts,
    async incr(key: string) {
      counts[key] = (counts[key] ?? 0) + 1;
      return counts[key];
    },
    async expire() {
      return 1;
    },
  };
}

const okSend = vi.fn(
  async (msgs: ExpoPushMessage[]): Promise<ExpoPushTicket[]> => msgs.map(() => ({ status: "ok" as const })),
);

const ARGS = { workspaceId: "ws-1" };

beforeEach(() => {
  vi.clearAllMocks();
  okSend.mockClear();
  // Default: the connection is currently disconnected (job is still valid).
  vi.mocked(db.emailConnection.findUnique).mockResolvedValue(
    { status: "DISCONNECTED", emailAddress: "a@b.com" } as never,
  );
});

describe("notifyGmailDisconnected", () => {
  it("fans out to workspace members' devices with the disconnected category/channel/payload", async () => {
    vi.mocked(db.pushDevice.findMany).mockResolvedValue([
      { expoPushToken: "tok-a1", userId: "user-a" },
      { expoPushToken: "tok-b1", userId: "user-b" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any);

    await notifyGmailDisconnected(ARGS, { store: makeStore(), send: okSend });

    // Tenant-scoped: only devices of members of this workspace.
    expect(db.pushDevice.findMany).toHaveBeenCalledWith({
      where: { user: { workspaceMemberships: { some: { workspaceId: "ws-1" } } } },
      select: { expoPushToken: true, userId: true },
    });
    const messages = okSend.mock.calls[0]![0];
    expect(messages.map((m) => m.to).sort()).toEqual(["tok-a1", "tok-b1"]);
    for (const m of messages) {
      expect(m.categoryId).toBe(PUSH_CATEGORY_GMAIL_DISCONNECTED);
      expect(m.channelId).toBe(PUSH_CHANNEL_TRIAGE);
      expect(m.body).toContain("a@b.com");
      expect(m.data).toMatchObject({ workspaceId: "ws-1", type: PUSH_CATEGORY_GMAIL_DISCONNECTED });
      expect(m.data).not.toHaveProperty("emailThreadId");
    }
  });

  it("no-ops when the connection is already ACTIVE again (stale job → idempotent retry)", async () => {
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue(
      { status: "ACTIVE", emailAddress: "a@b.com" } as never,
    );

    await notifyGmailDisconnected(ARGS, { store: makeStore(), send: okSend });

    expect(db.pushDevice.findMany).not.toHaveBeenCalled();
    expect(okSend).not.toHaveBeenCalled();
  });

  it("no-ops when the connection no longer exists", async () => {
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue(null);

    await notifyGmailDisconnected(ARGS, { store: makeStore(), send: okSend });

    expect(okSend).not.toHaveBeenCalled();
  });

  it("does nothing when no member has a registered device", async () => {
    vi.mocked(db.pushDevice.findMany).mockResolvedValue([]);

    await notifyGmailDisconnected(ARGS, { store: makeStore(), send: okSend });

    expect(okSend).not.toHaveBeenCalled();
  });

  it("consumes one budget unit per user across multiple devices", async () => {
    vi.mocked(db.pushDevice.findMany).mockResolvedValue([
      { expoPushToken: "tok-a1", userId: "user-a" },
      { expoPushToken: "tok-a2", userId: "user-a" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any);

    const store = makeStore();
    await notifyGmailDisconnected(ARGS, { store, send: okSend });

    expect(store.counts["push:budget:user-a"]).toBe(1);
  });

  it("suppresses a user who is over budget but still sends to others", async () => {
    vi.mocked(db.pushDevice.findMany).mockResolvedValue([
      { expoPushToken: "tok-a1", userId: "user-a" },
      { expoPushToken: "tok-b1", userId: "user-b" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any);

    // user-a is already at the limit; user-b is fresh.
    const store = makeStore({ "push:budget:user-a": 5 });
    await notifyGmailDisconnected(ARGS, { store, send: okSend });

    const messages = okSend.mock.calls[0]![0];
    expect(messages.map((m) => m.to)).toEqual(["tok-b1"]);
  });

  it("fails closed for a user when the budget store throws", async () => {
    vi.mocked(db.pushDevice.findMany).mockResolvedValue([
      { expoPushToken: "tok-a1", userId: "user-a" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any);

    const throwingStore: PushBudgetStore = {
      async incr() {
        throw new Error("redis down");
      },
      async expire() {
        return 1;
      },
    };

    await notifyGmailDisconnected(ARGS, { store: throwingStore, send: okSend });

    expect(okSend).not.toHaveBeenCalled();
  });
});
