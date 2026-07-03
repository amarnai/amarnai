import { vi, describe, it, expect, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@amarnai/db", () => ({
  db: {
    emailThread: { findFirst: vi.fn() },
    pushDevice: { findMany: vi.fn() },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  },
}));

import { db } from "@amarnai/db";
import { PUSH_CATEGORY_THREAD_ASSIGNED, PUSH_CHANNEL_TRIAGE } from "@amarnai/shared";
import { notifyThreadAssigned } from "../notifications/notify-thread-assigned.js";
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

const ARGS = { workspaceId: "ws-1", emailThreadId: "t-1", assigneeUserId: "user-a" };

beforeEach(() => {
  vi.clearAllMocks();
  okSend.mockClear();
  // Default: the thread is currently assigned to the job's assignee.
  vi.mocked(db.emailThread.findFirst).mockResolvedValue(
    { assignedToUserId: "user-a", subject: "Invoice due" } as never,
  );
});

describe("notifyThreadAssigned", () => {
  it("sends only to the assignee's devices with the assigned category/channel/payload", async () => {
    vi.mocked(db.pushDevice.findMany).mockResolvedValue([
      { expoPushToken: "tok-a1" },
      { expoPushToken: "tok-a2" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any);

    await notifyThreadAssigned(ARGS, { store: makeStore(), send: okSend });

    expect(db.pushDevice.findMany).toHaveBeenCalledWith({
      where: { userId: "user-a" },
      select: { expoPushToken: true },
    });
    expect(okSend).toHaveBeenCalledTimes(1);
    const messages = okSend.mock.calls[0]![0];
    expect(messages.map((m) => m.to).sort()).toEqual(["tok-a1", "tok-a2"]);
    for (const m of messages) {
      expect(m.categoryId).toBe(PUSH_CATEGORY_THREAD_ASSIGNED);
      expect(m.channelId).toBe(PUSH_CHANNEL_TRIAGE);
      expect(m.body).toBe("Invoice due");
      expect(m.data).toMatchObject({ workspaceId: "ws-1", emailThreadId: "t-1", type: PUSH_CATEGORY_THREAD_ASSIGNED });
    }
  });

  it("no-ops when the assignment changed since enqueue (stale job → idempotent retry)", async () => {
    vi.mocked(db.emailThread.findFirst).mockResolvedValue(
      { assignedToUserId: "user-b", subject: "x" } as never,
    );

    await notifyThreadAssigned(ARGS, { store: makeStore(), send: okSend });

    expect(db.pushDevice.findMany).not.toHaveBeenCalled();
    expect(okSend).not.toHaveBeenCalled();
  });

  it("no-ops when the thread no longer exists", async () => {
    vi.mocked(db.emailThread.findFirst).mockResolvedValue(null);

    await notifyThreadAssigned(ARGS, { store: makeStore(), send: okSend });

    expect(okSend).not.toHaveBeenCalled();
  });

  it("does nothing when the assignee has no devices", async () => {
    vi.mocked(db.pushDevice.findMany).mockResolvedValue([]);

    await notifyThreadAssigned(ARGS, { store: makeStore(), send: okSend });

    expect(okSend).not.toHaveBeenCalled();
  });

  it("consumes one budget unit per user across multiple devices", async () => {
    vi.mocked(db.pushDevice.findMany).mockResolvedValue([
      { expoPushToken: "tok-a1" },
      { expoPushToken: "tok-a2" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any);

    const store = makeStore();
    await notifyThreadAssigned(ARGS, { store, send: okSend });

    expect(store.counts["push:budget:user-a"]).toBe(1);
  });

  it("suppresses the push when the assignee is over budget", async () => {
    vi.mocked(db.pushDevice.findMany).mockResolvedValue([
      { expoPushToken: "tok-a1" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any);

    // user-a starts at the 5-per-window limit; the next incr (6) is over budget.
    const store = makeStore({ "push:budget:user-a": 5 });
    await notifyThreadAssigned(ARGS, { store, send: okSend });

    expect(okSend).not.toHaveBeenCalled();
  });

  it("fails closed when the budget store throws", async () => {
    vi.mocked(db.pushDevice.findMany).mockResolvedValue([
      { expoPushToken: "tok-a1" },
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

    await notifyThreadAssigned(ARGS, { store: throwingStore, send: okSend });

    expect(okSend).not.toHaveBeenCalled();
  });

  it("falls back to a generic body when the subject is empty", async () => {
    vi.mocked(db.emailThread.findFirst).mockResolvedValue(
      { assignedToUserId: "user-a", subject: null } as never,
    );
    vi.mocked(db.pushDevice.findMany).mockResolvedValue([
      { expoPushToken: "tok-a1" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any);

    await notifyThreadAssigned(ARGS, { store: makeStore(), send: okSend });

    expect(okSend.mock.calls[0]![0][0]!.body).toBe("A thread was assigned to you");
  });
});
