import { vi, describe, it, expect, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@amarnai/db", () => ({
  db: {
    pushDevice: { findMany: vi.fn() },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  },
}));

import { db } from "@amarnai/db";
import { PUSH_CATEGORY_THREAD_NEEDS_ATTENTION, PUSH_CHANNEL_TRIAGE } from "@amarnai/shared";
import {
  checkPushBudget,
  notifyThreadNeedsAttention,
  type PushBudgetStore,
} from "../notifications/notify-threads.js";
import type { ExpoPushMessage, ExpoPushTicket } from "../notifications/expo-push.js";

// A deterministic in-memory budget store: counts per key, allows the caller to
// pin a starting count per key to simulate a user already over budget.
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

beforeEach(() => {
  vi.clearAllMocks();
  okSend.mockClear();
});

// ─── Rate-limit logic ───────────────────────────────────────────────────────

describe("checkPushBudget", () => {
  it("allows hits up to the limit then blocks", async () => {
    const store = makeStore();
    const results: boolean[] = [];
    for (let i = 0; i < 5; i++) {
      results.push(await checkPushBudget(store, "user-1", 3, 900));
    }
    expect(results).toEqual([true, true, true, false, false]);
  });

  it("sets the TTL only on the first hit of the window", async () => {
    const store = makeStore();
    const expireSpy = vi.spyOn(store, "expire");
    await checkPushBudget(store, "user-1", 3, 900);
    await checkPushBudget(store, "user-1", 3, 900);
    expect(expireSpy).toHaveBeenCalledTimes(1);
    expect(expireSpy).toHaveBeenCalledWith("push:budget:user-1", 900);
  });

  it("counts each user independently", async () => {
    const store = makeStore();
    expect(await checkPushBudget(store, "user-a", 1, 900)).toBe(true);
    expect(await checkPushBudget(store, "user-a", 1, 900)).toBe(false);
    expect(await checkPushBudget(store, "user-b", 1, 900)).toBe(true);
  });
});

// ─── Emit logic ─────────────────────────────────────────────────────────────

describe("notifyThreadNeedsAttention", () => {
  it("scopes the device query to members of the workspace", async () => {
    vi.mocked(db.pushDevice.findMany).mockResolvedValue([]);
    await notifyThreadNeedsAttention(
      { workspaceId: "ws-1", emailThreadId: "t-1", subject: "Hi" },
      { store: makeStore(), send: okSend },
    );
    expect(db.pushDevice.findMany).toHaveBeenCalledWith({
      where: { user: { workspaceMemberships: { some: { workspaceId: "ws-1" } } } },
      select: { expoPushToken: true, userId: true },
    });
  });

  it("does nothing when there are no devices", async () => {
    vi.mocked(db.pushDevice.findMany).mockResolvedValue([]);
    await notifyThreadNeedsAttention(
      { workspaceId: "ws-1", emailThreadId: "t-1", subject: "Hi" },
      { store: makeStore(), send: okSend },
    );
    expect(okSend).not.toHaveBeenCalled();
  });

  it("sends one message per device with the right category, channel, and payload", async () => {
    vi.mocked(db.pushDevice.findMany).mockResolvedValue([
      { expoPushToken: "tok-a1", userId: "user-a" },
      { expoPushToken: "tok-a2", userId: "user-a" },
      { expoPushToken: "tok-b1", userId: "user-b" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any);

    await notifyThreadNeedsAttention(
      { workspaceId: "ws-1", emailThreadId: "t-9", subject: "Invoice due" },
      { store: makeStore(), send: okSend },
    );

    expect(okSend).toHaveBeenCalledTimes(1);
    const messages = okSend.mock.calls[0]![0];
    expect(messages).toHaveLength(3);
    expect(messages.map((m) => m.to).sort()).toEqual(["tok-a1", "tok-a2", "tok-b1"]);
    for (const m of messages) {
      expect(m.categoryId).toBe(PUSH_CATEGORY_THREAD_NEEDS_ATTENTION);
      expect(m.channelId).toBe(PUSH_CHANNEL_TRIAGE);
      expect(m.body).toBe("Invoice due");
      expect(m.data).toMatchObject({ workspaceId: "ws-1", emailThreadId: "t-9" });
    }
  });

  it("falls back to a generic body when the subject is empty", async () => {
    vi.mocked(db.pushDevice.findMany).mockResolvedValue([
      { expoPushToken: "tok-a1", userId: "user-a" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any);

    await notifyThreadNeedsAttention(
      { workspaceId: "ws-1", emailThreadId: "t-1", subject: null },
      { store: makeStore(), send: okSend },
    );
    expect(okSend.mock.calls[0]![0][0]!.body).toBe("A new thread needs your review");
  });

  it("consumes one budget unit per user, not per device", async () => {
    vi.mocked(db.pushDevice.findMany).mockResolvedValue([
      { expoPushToken: "tok-a1", userId: "user-a" },
      { expoPushToken: "tok-a2", userId: "user-a" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any);

    const store = makeStore();
    await notifyThreadNeedsAttention(
      { workspaceId: "ws-1", emailThreadId: "t-1", subject: "x" },
      { store, send: okSend },
    );
    // Two devices, one user → exactly one budget increment.
    expect(store.counts["push:budget:user-a"]).toBe(1);
  });

  it("suppresses devices of users already over budget", async () => {
    vi.mocked(db.pushDevice.findMany).mockResolvedValue([
      { expoPushToken: "tok-a1", userId: "user-a" },
      { expoPushToken: "tok-b1", userId: "user-b" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any);

    // user-b starts at the 5-per-window limit; the next incr (6) is over budget.
    const store = makeStore({ "push:budget:user-b": 5 });
    await notifyThreadNeedsAttention(
      { workspaceId: "ws-1", emailThreadId: "t-1", subject: "x" },
      { store, send: okSend },
    );

    expect(okSend).toHaveBeenCalledTimes(1);
    const messages = okSend.mock.calls[0]![0];
    expect(messages.map((m) => m.to)).toEqual(["tok-a1"]);
  });

  it("fails closed (skips a user) when the budget store throws", async () => {
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

    await notifyThreadNeedsAttention(
      { workspaceId: "ws-1", emailThreadId: "t-1", subject: "x" },
      { store: throwingStore, send: okSend },
    );
    expect(okSend).not.toHaveBeenCalled();
  });
});
