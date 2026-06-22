import { vi, describe, it, expect, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@amarnai/db", () => ({
  db: {
    workspace: { findUnique: vi.fn() },
    gmailConnection: { findUnique: vi.fn() },
    gmailSyncSettings: { findUnique: vi.fn() },
    emailAccount: { upsert: vi.fn() },
    providerSyncState: { upsert: vi.fn(), update: vi.fn() },
    taxonomyNode: { findMany: vi.fn() },
    taxonomyEdge: { findMany: vi.fn() },
    emailThread: {
      upsert: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    emailMessage: { upsert: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn() },
    backfillInboxQueue: { add: vi.fn() },
  },
  // Quota recovery counts recurring sorts; default to 0 so nothing is throttled.
  countRecurringThreadSorts: vi.fn().mockResolvedValue(0),
}));

vi.mock("@amarnai/config", () => ({
  config: { billing: { enforceThreadSortQuota: true } },
}));

const mockGetProfile = vi.fn();
const mockListRecentThreadIds = vi.fn();
const mockListHistory = vi.fn();
const mockGetThread = vi.fn();

vi.mock("@amarnai/gmail", () => ({
  GmailClient: vi.fn().mockImplementation(() => ({
    getProfile: mockGetProfile,
    listRecentThreadIds: mockListRecentThreadIds,
    listHistory: mockListHistory,
    getThread: mockGetThread,
  })),
  GmailAuthError: class GmailAuthError extends Error {},
  GmailHistoryCursorExpiredError: class GmailHistoryCursorExpiredError extends Error {},
  normalizeGmailThread: vi.fn().mockImplementation((raw: unknown) => {
    const r = raw as { id: string };
    return {
      providerThreadId: r.id,
      subject: "Test subject",
      latestMessageAt: new Date(),
      messageCount: 1,
      messages: [
        {
          providerMessageId: `msg-${r.id}`,
          senderEmail: "sender@example.com",
          senderName: "Sender",
          toEmails: [],
          ccEmails: [],
          subject: "Test subject",
          bodyExcerpt: "snippet",
          receivedAt: new Date(),
          attachments: [],
          labelIds: ["INBOX"],
        },
      ],
    };
  }),
}));

vi.mock("bullmq", () => ({
  Worker: vi.fn().mockImplementation((_queue: string, processor: unknown) => ({
    _processor: processor,
    on: vi.fn(),
  })),
  Queue: vi.fn().mockImplementation(() => ({
    addBulk: vi.fn().mockResolvedValue([]),
    add: vi.fn(),
    close: vi.fn(),
  })),
}));

vi.mock("../redis.js", () => ({ redisConnection: {} }));
vi.mock("../redis-publisher.js", () => ({ publishWorkspaceSynced: vi.fn().mockResolvedValue(undefined) }));

vi.mock("../queues.js", () => ({
  classifyThreadQueue: { addBulk: vi.fn().mockResolvedValue([]) },
  backfillInboxQueue: { add: vi.fn() },
  QUEUE_SYNC_INBOX: "sync-inbox",
  QUEUE_CLASSIFY_THREAD: "classify-thread",
  QUEUE_BACKFILL_INBOX: "backfill-inbox",
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import { db, countRecurringThreadSorts } from "@amarnai/db";
import { Worker } from "bullmq";
import { classifyThreadQueue } from "../queues.js";
import { createSyncInboxWorker } from "../jobs/sync-inbox.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const WS_ID = "ws-1";

function getProcessor(): (job: unknown) => Promise<void> {
  const WorkerMock = vi.mocked(Worker);
  const lastCall = WorkerMock.mock.calls[WorkerMock.mock.calls.length - 1];
  return lastCall?.[1] as (job: unknown) => Promise<void>;
}

function makeJob(data: Record<string, string>) {
  return { data, updateProgress: vi.fn() };
}

const ROOT_NODE_ID = "root-id";

function makeNodes(nonRootCount: number) {
  return [
    { id: ROOT_NODE_ID, isRoot: true },
    ...Array.from({ length: nonRootCount }, (_, i) => ({ id: `node-${i + 1}`, isRoot: false })),
  ];
}

/** Edges linking the first `linkedCount` non-root nodes to the root. */
function makeEdges(linkedCount: number) {
  return Array.from({ length: linkedCount }, (_, i) => ({
    sourceNodeId: ROOT_NODE_ID,
    targetNodeId: `node-${i + 1}`,
  }));
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  vi.mocked(db.workspace.findUnique).mockResolvedValue({
    ownerUserId: "user-1",
    plan: "PRO",
  } as never);
  vi.mocked(db.gmailConnection.findUnique).mockResolvedValue({
    gmailAddress: "test@gmail.com",
    googleSubjectId: "sub-1",
    encryptedRefreshToken: "enc-token",
    status: "ACTIVE",
  } as never);
  vi.mocked(db.gmailSyncSettings.findUnique).mockResolvedValue({
    includeSpam: false,
    includePromotions: false,
    sortingPaused: false,
    blacklistedSenderEmails: [],
  } as never);
  vi.mocked(db.emailAccount.upsert).mockResolvedValue({ id: "account-1" } as never);
  vi.mocked(db.providerSyncState.upsert).mockResolvedValue({
    historyId: "hist-1",
    backfillStatus: "DONE",
    backfillStartedAt: null,
    importantBackfilled: true,
  } as never);
  vi.mocked(db.providerSyncState.update).mockResolvedValue({} as never);
  vi.mocked(db.emailThread.upsert).mockResolvedValue({ id: "db-t1" } as never);
  vi.mocked(db.emailMessage.upsert).mockResolvedValue({} as never);
  vi.mocked(db.emailMessage.deleteMany).mockResolvedValue({ count: 0 } as never);
  // Default: no messages stored yet, so every synced thread looks brand-new and
  // counts as content-changed. Tests for label-only changes override this.
  vi.mocked(db.emailMessage.findMany).mockResolvedValue([] as never);

  mockGetProfile.mockResolvedValue({ historyId: "hist-2" });
  mockListHistory.mockResolvedValue({
    changedThreadIds: ["gmail-t1"],
    newHistoryId: "hist-2",
  });
  mockGetThread.mockResolvedValue({ id: "gmail-t1" });

  // Default: taxonomy is strong enough (3 non-root nodes all linked to root).
  vi.mocked(db.taxonomyNode.findMany).mockResolvedValue(makeNodes(3) as never);
  vi.mocked(db.taxonomyEdge.findMany).mockResolvedValue(makeEdges(3) as never);
  vi.mocked(classifyThreadQueue.addBulk).mockResolvedValue([]);
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("createSyncInboxWorker — taxonomy gate", () => {
  it("leaves threads PENDING and does not enqueue when taxonomy is weak", async () => {
    // Only 2 non-root nodes linked to the root → below threshold.
    vi.mocked(db.taxonomyNode.findMany).mockResolvedValue(makeNodes(2) as never);
    vi.mocked(db.taxonomyEdge.findMany).mockResolvedValue(makeEdges(2) as never);

    createSyncInboxWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID }));

    const calls = vi.mocked(db.emailThread.updateMany).mock.calls;
    const unroutedCall = calls.find(
      (c) => (c[0] as { data: { triageStatus?: string } }).data?.triageStatus === "UNROUTED"
    );
    expect(unroutedCall).toBeUndefined();
    expect(classifyThreadQueue.addBulk).not.toHaveBeenCalled();
  });

  it("leaves threads PENDING when nodes exist but are not linked to root", async () => {
    // 3 non-root nodes but no edges → none reachable from root → not routable.
    vi.mocked(db.taxonomyNode.findMany).mockResolvedValue(makeNodes(3) as never);
    vi.mocked(db.taxonomyEdge.findMany).mockResolvedValue([] as never);

    createSyncInboxWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID }));

    const calls = vi.mocked(db.emailThread.updateMany).mock.calls;
    const unroutedCall = calls.find(
      (c) => (c[0] as { data: { triageStatus?: string } }).data?.triageStatus === "UNROUTED"
    );
    expect(unroutedCall).toBeUndefined();
    expect(classifyThreadQueue.addBulk).not.toHaveBeenCalled();
  });

  it("enqueues classify jobs when taxonomy is strong and sorting is not paused", async () => {
    createSyncInboxWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID }));

    expect(classifyThreadQueue.addBulk).toHaveBeenCalledOnce();
    const calls = vi.mocked(db.emailThread.updateMany).mock.calls;
    const unroutedCall = calls.find(
      (c) => (c[0] as { data: { triageStatus?: string } }).data?.triageStatus === "UNROUTED"
    );
    expect(unroutedCall).toBeUndefined();
  });

  it("does not re-classify a thread when only a label changed (message set unchanged)", async () => {
    // The thread already has exactly the message the snapshot reports, so this
    // sync reflects a label-only change (read/star/archive). No new message
    // arrived and none was removed, so no classify job should be enqueued.
    vi.mocked(db.emailMessage.findMany).mockResolvedValue([
      { providerMessageId: "msg-gmail-t1" },
    ] as never);

    createSyncInboxWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID }));

    expect(classifyThreadQueue.addBulk).not.toHaveBeenCalled();
    // The thread was still touched: classifyingAt is never stamped for it.
    const classifyingStamp = vi
      .mocked(db.emailThread.updateMany)
      .mock.calls.find(
        (c) => (c[0] as { data?: { classifyingAt?: unknown } }).data?.classifyingAt != null
      );
    expect(classifyingStamp).toBeUndefined();
  });

  it("re-classifies a thread when a new message arrived alongside existing ones", async () => {
    // A different message ID is already stored; the snapshot's message is new,
    // so the message set changed and the thread must be re-sorted.
    vi.mocked(db.emailMessage.findMany).mockResolvedValue([
      { providerMessageId: "msg-old" },
    ] as never);

    createSyncInboxWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID }));

    expect(classifyThreadQueue.addBulk).toHaveBeenCalledOnce();
  });

  it("does not mark threads as UNROUTED when sortingPaused is true (leaves PENDING)", async () => {
    vi.mocked(db.gmailSyncSettings.findUnique).mockResolvedValue({
      includeSpam: false,
      includePromotions: false,
      sortingPaused: true,
      blacklistedSenderEmails: [],
    } as never);

    createSyncInboxWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID }));

    expect(classifyThreadQueue.addBulk).not.toHaveBeenCalled();
    const calls = vi.mocked(db.emailThread.updateMany).mock.calls;
    const unroutedCall = calls.find(
      (c) => (c[0] as { data: { triageStatus?: string } }).data?.triageStatus === "UNROUTED"
    );
    expect(unroutedCall).toBeUndefined();
  });

  it("loads the taxonomy exactly once per sync cycle regardless of thread count", async () => {
    // Two threads changed this cycle.
    mockListHistory.mockResolvedValue({
      changedThreadIds: ["gmail-t1", "gmail-t2"],
      newHistoryId: "hist-2",
    });
    mockGetThread
      .mockResolvedValueOnce({ id: "gmail-t1" })
      .mockResolvedValueOnce({ id: "gmail-t2" });
    vi.mocked(db.emailThread.upsert)
      .mockResolvedValueOnce({ id: "db-t1" } as never)
      .mockResolvedValueOnce({ id: "db-t2" } as never);

    createSyncInboxWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID }));

    expect(db.taxonomyNode.findMany).toHaveBeenCalledOnce();
    expect(db.taxonomyEdge.findMany).toHaveBeenCalledOnce();
  });
});

// ─── QUOTA_BLOCKED recovery ────────────────────────────────────────────────────

describe("createSyncInboxWorker — quota-blocked recovery", () => {
  // Make findMany return a deferred thread only for the QUOTA_BLOCKED query.
  function withBlockedThread(id: string) {
    vi.mocked(db.emailThread.findMany).mockImplementation((args: unknown) => {
      const where = (args as { where?: { triageStatus?: string } }).where;
      return Promise.resolve(
        where?.triageStatus === "QUOTA_BLOCKED" ? [{ id }] : []
      ) as never;
    });
  }

  function quotaRecoveryCall() {
    return vi.mocked(classifyThreadQueue.addBulk).mock.calls.find((call) => {
      const jobs = call[0] as Array<{ opts?: { deduplication?: { id?: string } } }>;
      return jobs.some((j) => j.opts?.deduplication?.id?.includes("classify_quota_recovery"));
    });
  }

  it("re-enqueues QUOTA_BLOCKED threads as LIVE when capacity is free", async () => {
    withBlockedThread("qb-1");

    createSyncInboxWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID }));

    // Moved back to PENDING with classifyingAt stamped.
    const toPending = vi.mocked(db.emailThread.updateMany).mock.calls.find(
      (c) => (c[0] as { data: { triageStatus?: string } }).data?.triageStatus === "PENDING"
    );
    expect(toPending).toBeDefined();

    const recovery = quotaRecoveryCall();
    expect(recovery).toBeDefined();
    const jobs = recovery![0] as Array<{ data: { source?: string } }>;
    expect(jobs[0]!.data.source).toBe("LIVE");
  });

  it("does not recover when the workspace is still at its limit", async () => {
    withBlockedThread("qb-1");
    // PRO limit is 10000; pretend it is already full.
    vi.mocked(countRecurringThreadSorts).mockResolvedValue(10_000);

    createSyncInboxWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID }));

    expect(quotaRecoveryCall()).toBeUndefined();
  });

  it("does not recover when sorting is paused", async () => {
    withBlockedThread("qb-1");
    vi.mocked(db.gmailSyncSettings.findUnique).mockResolvedValue({
      includeSpam: false,
      includePromotions: false,
      sortingPaused: true,
      blacklistedSenderEmails: [],
    } as never);

    createSyncInboxWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID }));

    expect(quotaRecoveryCall()).toBeUndefined();
  });
});

// ─── Failed-thread recovery ────────────────────────────────────────────────────

describe("createSyncInboxWorker — failed-thread recovery", () => {
  // findMany returns a failed thread only for the failed-recovery query (the one
  // that filters on classifyFailedAt); the QUOTA_BLOCKED query returns nothing.
  function withFailedThread(id: string) {
    vi.mocked(db.emailThread.findMany).mockImplementation((args: unknown) => {
      const where = (args as { where?: { classifyFailedAt?: unknown } }).where;
      return Promise.resolve(where?.classifyFailedAt ? [{ id }] : []) as never;
    });
  }

  function failedRecoveryCall() {
    return vi.mocked(classifyThreadQueue.addBulk).mock.calls.find((call) => {
      const jobs = call[0] as Array<{ opts?: { deduplication?: { id?: string } } }>;
      return jobs.some((j) => j.opts?.deduplication?.id?.includes("classify_failed_recovery"));
    });
  }

  it("re-enqueues failed threads as LIVE and stamps classifyingAt", async () => {
    withFailedThread("f-1");
    vi.mocked(countRecurringThreadSorts).mockResolvedValue(0); // capacity free

    createSyncInboxWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID }));

    const recovery = failedRecoveryCall();
    expect(recovery).toBeDefined();
    const jobs = recovery![0] as Array<{ data: { source?: string } }>;
    expect(jobs[0]!.data.source).toBe("LIVE");

    // Stamped classifyingAt (without changing triageStatus — already PENDING).
    const stamped = vi.mocked(db.emailThread.updateMany).mock.calls.find((c) => {
      const data = (c[0] as { data: { classifyingAt?: unknown; triageStatus?: unknown } }).data;
      return data?.classifyingAt != null && data?.triageStatus === undefined;
    });
    expect(stamped).toBeDefined();
  });

  it("only targets attempted-and-failed threads, never the bulk backlog", async () => {
    withFailedThread("f-1");

    createSyncInboxWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID }));

    // The recovery query must require classifyFailedAt set and bound attempts, so
    // never-attempted backlog threads (classifyFailedAt null) are excluded.
    const failedQuery = vi.mocked(db.emailThread.findMany).mock.calls.find(
      (c) => (c[0] as { where?: { classifyFailedAt?: unknown } }).where?.classifyFailedAt !== undefined
    );
    expect(failedQuery).toBeDefined();
    const where = (failedQuery![0] as {
      where: { triageStatus: string; classifyFailedAt: unknown; classifyAttempts: unknown };
    }).where;
    expect(where.triageStatus).toBe("PENDING");
    expect(where.classifyFailedAt).toEqual({ not: null });
    expect(where.classifyAttempts).toEqual({ lt: 5 });
  });

  it("does not recover when sorting is paused", async () => {
    withFailedThread("f-1");
    vi.mocked(db.gmailSyncSettings.findUnique).mockResolvedValue({
      includeSpam: false,
      includePromotions: false,
      sortingPaused: true,
      blacklistedSenderEmails: [],
    } as never);

    createSyncInboxWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID }));

    expect(failedRecoveryCall()).toBeUndefined();
  });
});

// ─── Disconnect-awareness ─────────────────────────────────────────────────────

describe("createSyncInboxWorker — disconnect-awareness", () => {
  it("returns gracefully when connection status is not ACTIVE", async () => {
    vi.mocked(db.gmailConnection.findUnique).mockResolvedValue({
      gmailAddress: "test@gmail.com",
      googleSubjectId: "sub-1",
      encryptedRefreshToken: "enc-token",
      status: "DISCONNECTED",
    } as never);

    createSyncInboxWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID }));

    // Should not load taxonomy, touch syncState, or make any Gmail calls
    expect(db.taxonomyNode.findMany).not.toHaveBeenCalled();
    expect(db.providerSyncState.upsert).not.toHaveBeenCalled();
    expect(mockGetProfile).not.toHaveBeenCalled();
  });

  it("triggers backfill when RUNNING is stale (worker-crash recovery)", async () => {
    const staleDate = new Date(Date.now() - 2 * 60 * 60 * 1_000); // 2 hours ago
    // Quiet inbox cycle so we hit the backfill-trigger branch
    mockListHistory.mockResolvedValue({ changedThreadIds: [], newHistoryId: "hist-2" });
    vi.mocked(db.providerSyncState.upsert).mockResolvedValue({
      historyId: "hist-1",
      backfillStatus: "RUNNING",
      backfillStartedAt: staleDate,
      importantBackfilled: true,
    } as never);

    createSyncInboxWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID }));

    expect(vi.mocked(mockListRecentThreadIds)).not.toHaveBeenCalled();
    const { backfillInboxQueue } = await import("../queues.js");
    expect(vi.mocked(backfillInboxQueue.add)).toHaveBeenCalledWith(
      "backfill-inbox",
      { workspaceId: WS_ID },
      expect.objectContaining({ deduplication: { id: `backfill-inbox_${WS_ID}` } })
    );
  });

  it("triggers backfill even when taxonomy is weak", async () => {
    // Weak taxonomy: only 2 non-root nodes linked to the root.
    vi.mocked(db.taxonomyNode.findMany).mockResolvedValue(makeNodes(2) as never);
    vi.mocked(db.taxonomyEdge.findMany).mockResolvedValue(makeEdges(2) as never);
    // Quiet inbox cycle with a resumable (PENDING) backfill so we hit the trigger.
    mockListHistory.mockResolvedValue({ changedThreadIds: [], newHistoryId: "hist-2" });
    vi.mocked(db.providerSyncState.upsert).mockResolvedValue({
      historyId: "hist-1",
      backfillStatus: "PENDING",
      backfillStartedAt: null,
      importantBackfilled: true,
    } as never);

    createSyncInboxWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID }));

    const { backfillInboxQueue } = await import("../queues.js");
    expect(vi.mocked(backfillInboxQueue.add)).toHaveBeenCalledWith(
      "backfill-inbox",
      { workspaceId: WS_ID },
      expect.objectContaining({ deduplication: { id: `backfill-inbox_${WS_ID}` } })
    );
  });

  it("does not trigger backfill when RUNNING is fresh (another worker is running it)", async () => {
    const freshDate = new Date(); // just now
    mockListHistory.mockResolvedValue({ changedThreadIds: [], newHistoryId: "hist-2" });
    vi.mocked(db.providerSyncState.upsert).mockResolvedValue({
      historyId: "hist-1",
      backfillStatus: "RUNNING",
      backfillStartedAt: freshDate,
      importantBackfilled: true,
    } as never);

    createSyncInboxWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID }));

    const { backfillInboxQueue } = await import("../queues.js");
    expect(vi.mocked(backfillInboxQueue.add)).not.toHaveBeenCalled();
  });
});
