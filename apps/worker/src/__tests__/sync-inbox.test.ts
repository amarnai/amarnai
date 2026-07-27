import { vi, describe, it, expect, beforeEach } from "vitest";
import { createHash } from "node:crypto";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@amarnai/db", () => ({
  // Real implementation, not a stub: the dedup key it produces is asserted below,
  // so a fake would make those assertions meaningless.
  messageSetSignature: (ids: string[]) =>
    createHash("sha1").update([...ids].sort().join(",")).digest("hex").slice(0, 16),
  db: {
    workspace: { findUnique: vi.fn() },
    emailConnection: { findUnique: vi.fn() },
    gmailSyncSettings: { findUnique: vi.fn() },
    emailAccount: { upsert: vi.fn() },
    providerSyncState: { upsert: vi.fn(), update: vi.fn() },
    taxonomyNode: { findMany: vi.fn() },
    taxonomyEdge: { findMany: vi.fn() },
    emailThread: {
      upsert: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    emailMessage: { upsert: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn() },
    backfillInboxQueue: { add: vi.fn() },
  },
  // Recovery gates on the reset-immune, inbox-pooled meter (resolveInboxQuota →
  // InboxUsageMeter), the SAME counter the classify worker accounts on — never a
  // deletable EmailClassification count. Default to 0 used so nothing is
  // throttled; plan PRO matches the workspace mock (limit 5000).
  resolveInboxQuota: vi.fn().mockResolvedValue({
    inboxKey: "test@gmail.com",
    windowStart: new Date(),
    plan: "PRO",
    used: 0,
  }),
}));

vi.mock("@amarnai/config", () => ({
  config: { billing: { enforceThreadSortQuota: true } },
}));

const mockGetProfile = vi.fn();
const mockListRecentThreadIds = vi.fn();
const mockListHistory = vi.fn();
const mockGetThread = vi.fn();

vi.mock("@amarnai/gmail", () => {
  // getThreadSnapshot folds the raw fetch (mockGetThread — so error tests still
  // drive rejections) and normalization into one call, matching the real client.
  const normalize = (raw: unknown) => {
    const r = raw as { id: string; senderEmail?: string; labelIds?: string[] };
    const senderEmail = r.senderEmail ?? "sender@example.com";
    return {
      provider: "gmail" as const,
      providerThreadId: r.id,
      subject: "Test subject",
      participants: [senderEmail],
      latestMessageAt: new Date(),
      messageCount: 1,
      messages: [
        {
          providerMessageId: `msg-${r.id}`,
          senderEmail,
          senderName: "Sender",
          toEmails: [],
          ccEmails: [],
          subject: "Test subject",
          bodyExcerpt: "snippet",
          receivedAt: new Date(),
          attachments: [],
          labelIds: r.labelIds ?? ["INBOX"],
        },
      ],
    };
  };
  return {
    GmailClient: vi.fn().mockImplementation(() => ({
      getProfile: mockGetProfile,
      listRecentThreadIds: mockListRecentThreadIds,
      listChangesSince: mockListHistory,
      getThreadSnapshot: async (id: string) => normalize(await mockGetThread(id)),
    })),
    GmailAuthError: class GmailAuthError extends Error {},
    GmailHistoryCursorExpiredError: class GmailHistoryCursorExpiredError extends Error {},
    GmailThreadParseError: class GmailThreadParseError extends Error {},
    GmailThreadNotFoundError: class GmailThreadNotFoundError extends Error {},
  };
});

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

import { db, resolveInboxQuota } from "@amarnai/db";
import { Worker } from "bullmq";
import { GmailHistoryCursorExpiredError, GmailThreadNotFoundError } from "@amarnai/gmail";
import { classifyThreadQueue } from "../queues.js";
import { DEDUP_CLASSIFY_UNROUTED } from "@amarnai/queue";
import { createSyncInboxWorker } from "../jobs/sync-inbox.js";

/**
 * Build a resolveInboxQuota result reporting `used` recurring sorts on the PRO
 * plan (limit 5000) — the reset-immune inbox meter the recovery gate reads.
 */
function quotaUsed(used: number) {
  return { inboxKey: "test@gmail.com", windowStart: new Date(), plan: "PRO" as const, used };
}

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
  vi.mocked(db.emailConnection.findUnique).mockResolvedValue({
    provider: "GMAIL",
    emailAddress: "test@gmail.com",
    subjectId: "sub-1",
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
    // Steady state: the user has already started backfill routing, so live sync
    // classifies new threads as LIVE. Tests that exercise the pre-start window
    // override this with backfillRoutingStartedAt: null.
    backfillRoutingStartedAt: new Date(),
  } as never);
  vi.mocked(db.providerSyncState.update).mockResolvedValue({} as never);
  vi.mocked(db.emailThread.upsert).mockResolvedValue({ id: "db-t1" } as never);
  vi.mocked(db.emailMessage.upsert).mockResolvedValue({} as never);
  vi.mocked(db.emailMessage.deleteMany).mockResolvedValue({ count: 0 } as never);
  // Default: no messages stored yet, so every synced thread looks brand-new and
  // counts as content-changed. Tests for label-only changes override this.
  vi.mocked(db.emailMessage.findMany).mockResolvedValue([] as never);

  mockGetProfile.mockResolvedValue({ syncCursor: "hist-2" });
  mockListHistory.mockResolvedValue({
    changedThreadIds: ["gmail-t1"],
    removedMessageIds: [],
    newCursor: "hist-2",
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

  it("leaves new threads PENDING and does not classify before backfill routing has started", async () => {
    // Taxonomy is strong and sorting is not paused, but the user has not started
    // backfill routing yet. New live threads must stay PENDING (import-only) so
    // they are swept as BACKFILL on start, never charged to quota as LIVE.
    vi.mocked(db.providerSyncState.upsert).mockResolvedValue({
      historyId: "hist-1",
      backfillStatus: "RUNNING",
      backfillStartedAt: new Date(),
      backfillRoutingStartedAt: null,
    } as never);

    createSyncInboxWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID }));

    expect(classifyThreadQueue.addBulk).not.toHaveBeenCalled();
    // No classifyingAt stamp either — the thread is simply imported and left PENDING.
    const classifyingStamp = vi
      .mocked(db.emailThread.updateMany)
      .mock.calls.find(
        (c) => (c[0] as { data?: { classifyingAt?: unknown } }).data?.classifyingAt != null
      );
    expect(classifyingStamp).toBeUndefined();
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

  // ── Inbox-removal re-sort (Outlook/Gmail parity) ──────────────────────────
  //
  // A message archived / deleted / moved out of the inbox surfaces as an
  // @removed delta entry that carries only a message id (Outlook) — no thread
  // id. The worker resolves that message id to its owning thread from persisted
  // data and re-sorts the thread, matching Gmail (where an INBOX-label removal
  // re-surfaces the whole thread). db.emailMessage.findMany is now called twice
  // per synced thread — once to resolve the removed id → thread, once for the
  // prior-message-set diff — so these tests route it by query shape.

  it("re-sorts a multi-message thread when one message is removed from the inbox (parity)", async () => {
    // Only the removal surfaces: no created/updated entry for this conversation.
    mockListHistory.mockResolvedValue({
      changedThreadIds: [],
      removedMessageIds: ["msg-removed"],
      newCursor: "hist-2",
    });
    // The remaining inbox message keeps the thread alive.
    mockGetThread.mockResolvedValue({ id: "gmail-t1" });
    vi.mocked(db.emailMessage.findMany).mockImplementation((args: unknown) => {
      const where = (args as { where?: { providerMessageId?: { in?: string[] } } }).where ?? {};
      // Resolution query: removed provider message id → its thread's providerThreadId.
      if (where.providerMessageId?.in) {
        return Promise.resolve([{ thread: { providerThreadId: "gmail-t1" } }]) as never;
      }
      // Prior message set: both the surviving and the now-removed message were stored.
      return Promise.resolve([
        { providerMessageId: "msg-gmail-t1" },
        { providerMessageId: "msg-removed" },
      ]) as never;
    });

    createSyncInboxWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID }));

    // The removed message dropped out of the (inbox-scoped) snapshot, so the
    // message set changed → the thread is re-sorted.
    expect(classifyThreadQueue.addBulk).toHaveBeenCalledOnce();
    const [jobs] = vi.mocked(classifyThreadQueue.addBulk).mock.calls[0]! as [
      Array<{ data: { emailThreadId: string } }>,
    ];
    expect(jobs[0]!.data.emailThreadId).toBe("db-t1");
  });

  it("does not error and does not re-sort when the thread's only message left the inbox", async () => {
    // The removed message was the whole thread: its snapshot is now empty, which
    // the provider surfaces as the typed not-found. The worker skips it (existing
    // gone-from-inbox handling) — no crash, no classify.
    mockListHistory.mockResolvedValue({
      changedThreadIds: [],
      removedMessageIds: ["msg-only"],
      newCursor: "hist-2",
    });
    mockGetThread.mockRejectedValue(
      new GmailThreadNotFoundError("Graph conversation not found: gmail-gone"),
    );
    vi.mocked(db.emailMessage.findMany).mockImplementation((args: unknown) => {
      const where = (args as { where?: { providerMessageId?: { in?: string[] } } }).where ?? {};
      if (where.providerMessageId?.in) {
        return Promise.resolve([{ thread: { providerThreadId: "gmail-gone" } }]) as never;
      }
      return Promise.resolve([]) as never;
    });

    createSyncInboxWorker();
    const processor = getProcessor();
    await expect(processor(makeJob({ workspaceId: WS_ID }))).resolves.toBeUndefined();

    expect(classifyThreadQueue.addBulk).not.toHaveBeenCalled();
    // The cursor still advances past the handled removal.
    const advance = vi
      .mocked(db.providerSyncState.update)
      .mock.calls.find((c) => (c[0] as { data: { historyId?: string } }).data?.historyId !== undefined);
    expect(advance).toBeDefined();
  });

  it("ignores a removed message id that was never stored locally (no-op)", async () => {
    // Unknown id → resolution finds no row → nothing added to the changed set,
    // so no snapshot fetch and no classify. The cursor still advances.
    mockListHistory.mockResolvedValue({
      changedThreadIds: [],
      removedMessageIds: ["msg-unknown"],
      newCursor: "hist-2",
    });
    // Resolution returns nothing; no prior-message query runs (no changed threads).
    vi.mocked(db.emailMessage.findMany).mockResolvedValue([] as never);

    createSyncInboxWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID }));

    expect(classifyThreadQueue.addBulk).not.toHaveBeenCalled();
    expect(vi.mocked(db.emailThread.upsert)).not.toHaveBeenCalled();
    const advance = vi
      .mocked(db.providerSyncState.update)
      .mock.calls.find((c) => (c[0] as { data: { historyId?: string } }).data?.historyId !== undefined);
    expect(advance).toBeDefined();
  });

  it("keys the LIVE classify enqueue on a content signature so new messages are not dropped (Issue 13 / #4)", async () => {
    createSyncInboxWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID }));

    const [jobs] = vi.mocked(classifyThreadQueue.addBulk).mock.calls[0]! as [
      Array<{ opts: { deduplication: { id: string } } }>,
    ];
    // The default snapshot has one message `msg-gmail-t1`; the dedup id folds in a
    // signature of that set, so a spurious re-discovery collapses but a genuinely-new
    // message (a different set → different signature) enqueues instead of being dropped.
    const sig = createHash("sha1").update(["msg-gmail-t1"].sort().join(",")).digest("hex").slice(0, 16);
    expect(jobs[0]!.opts.deduplication.id).toBe(`classify_live_${WS_ID}_db-t1_${sig}`);

    // Same content on a second sync → identical key (collapses the duplicate).
    vi.mocked(classifyThreadQueue.addBulk).mockClear();
    await processor(makeJob({ workspaceId: WS_ID }));
    const [jobs2] = vi.mocked(classifyThreadQueue.addBulk).mock.calls[0]! as [
      Array<{ opts: { deduplication: { id: string } } }>,
    ];
    expect(jobs2[0]!.opts.deduplication.id).toBe(`classify_live_${WS_ID}_db-t1_${sig}`);
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
      newCursor: "hist-2",
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

  it("does not recover when the inbox meter is still at its limit", async () => {
    withBlockedThread("qb-1");
    // PRO limit is 5000; the reset-immune meter reports usage exactly at the cap.
    // This is the reset-immunity guarantee: even after resetWorkspaceData wipes
    // this workspace's EmailClassification rows, the inbox meter still reads
    // at-cap, so a disconnect+reconnect cannot refund quota and recovery stays
    // blocked (remaining = 5000 - 5000 = 0).
    vi.mocked(resolveInboxQuota).mockResolvedValue(quotaUsed(5000));

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
    vi.mocked(resolveInboxQuota).mockResolvedValue(quotaUsed(0)); // capacity free

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

// ─── Stale-classifying recovery ────────────────────────────────────────────────

describe("createSyncInboxWorker — stale-classifying recovery", () => {
  // findMany returns a thread only for the stale-classifying query (PENDING with
  // a classifyingAt range filter, and no classifyFailedAt filter).
  function withStaleThread(id: string, classifyingAt: { lt: Date } | undefined) {
    vi.mocked(db.emailThread.findMany).mockImplementation((args: unknown) => {
      const where = (args as {
        where?: { triageStatus?: string; classifyingAt?: unknown; classifyFailedAt?: unknown };
      }).where;
      const isStaleQuery =
        where?.triageStatus === "PENDING" &&
        where?.classifyingAt !== null &&
        where?.classifyingAt !== undefined &&
        where?.classifyFailedAt === undefined;
      return Promise.resolve(isStaleQuery && classifyingAt ? [{ id }] : []) as never;
    });
  }

  function staleRecoveryCall() {
    return vi.mocked(classifyThreadQueue.addBulk).mock.calls.find((call) => {
      const jobs = call[0] as Array<{ opts?: { deduplication?: { id?: string } } }>;
      return jobs.some((j) => j.opts?.deduplication?.id?.includes("classify_stale_recovery"));
    });
  }

  it("re-enqueues a thread whose classifyingAt is stale", async () => {
    withStaleThread("s-1", { lt: new Date() });
    vi.mocked(resolveInboxQuota).mockResolvedValue(quotaUsed(0)); // capacity free

    createSyncInboxWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID }));

    const recovery = staleRecoveryCall();
    expect(recovery).toBeDefined();
    const jobs = recovery![0] as Array<{ data: { source?: string } }>;
    expect(jobs[0]!.data.source).toBe("LIVE");
  });

  it("uses a stale classifyingAt window and the PENDING status in the query", async () => {
    withStaleThread("s-1", { lt: new Date() });
    vi.mocked(resolveInboxQuota).mockResolvedValue(quotaUsed(0));

    createSyncInboxWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID }));

    const staleQuery = vi.mocked(db.emailThread.findMany).mock.calls.find((c) => {
      const where = (c[0] as {
        where?: { triageStatus?: string; classifyingAt?: { lt?: Date }; classifyFailedAt?: unknown };
      }).where;
      return where?.triageStatus === "PENDING" && where?.classifyingAt != null && where?.classifyFailedAt === undefined;
    });
    expect(staleQuery).toBeDefined();
    const where = (staleQuery![0] as { where: { classifyingAt: { lt: Date } } }).where;
    // The cutoff is 15 minutes in the past.
    const cutoff = where.classifyingAt.lt.getTime();
    expect(Date.now() - cutoff).toBeGreaterThanOrEqual(15 * 60 * 1000 - 5_000);
  });

  it("does not recover a thread whose classifyingAt is recent (returned by the query as empty)", async () => {
    // No thread matches the stale window → query returns nothing → no recovery.
    withStaleThread("s-1", undefined);
    vi.mocked(resolveInboxQuota).mockResolvedValue(quotaUsed(0));

    createSyncInboxWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID }));

    expect(staleRecoveryCall()).toBeUndefined();
  });
});

// ─── Auto-route-backlog arming ──────────────────────────────────────────────────

describe("createSyncInboxWorker — armed backlog recovery", () => {
  // Mark the backfill in flight with the arm set.
  function armedSyncState() {
    vi.mocked(db.providerSyncState.upsert).mockResolvedValue({
      historyId: "hist-1",
      backfillStatus: "RUNNING",
      backfillStartedAt: new Date(),
      autoRouteBacklogArmed: true,
    } as never);
  }

  // findMany returns a thread only for the armed-backlog query: PENDING, never
  // attempted (classifyFailedAt null), not queued (classifyingAt null), not trash.
  function withBacklogThread(id: string) {
    vi.mocked(db.emailThread.findMany).mockImplementation((args: unknown) => {
      const where = (args as {
        where?: { triageStatus?: string; classifyFailedAt?: unknown; classifyingAt?: unknown; gmailIsTrash?: unknown };
      }).where;
      const isArmedQuery =
        where?.triageStatus === "PENDING" &&
        where?.classifyFailedAt === null &&
        where?.classifyingAt === null &&
        where?.gmailIsTrash === false;
      return Promise.resolve(isArmedQuery ? [{ id }] : []) as never;
    });
  }

  function armedBacklogCall() {
    return vi.mocked(classifyThreadQueue.addBulk).mock.calls.find((call) => {
      const jobs = call[0] as Array<{ opts?: { deduplication?: { id?: string } } }>;
      return jobs.some((j) => j.opts?.deduplication?.id?.includes(DEDUP_CLASSIFY_UNROUTED));
    });
  }

  it("routes the never-attempted backlog as BACKFILL when armed", async () => {
    armedSyncState();
    withBacklogThread("bk-1");

    createSyncInboxWorker();
    await getProcessor()(makeJob({ workspaceId: WS_ID }));

    const recovery = armedBacklogCall();
    expect(recovery).toBeDefined();
    const jobs = recovery![0] as Array<{ data: { source?: string } }>;
    // Arming happens during the initial (quota-exempt) backfill, so the swept
    // backlog is attributed BACKFILL, matching the manual start path.
    expect(jobs[0]!.data.source).toBe("BACKFILL");
  });

  it("does not route the backlog when not armed", async () => {
    // Default upsert leaves autoRouteBacklogArmed unset (falsy).
    withBacklogThread("bk-1");

    createSyncInboxWorker();
    await getProcessor()(makeJob({ workspaceId: WS_ID }));

    expect(armedBacklogCall()).toBeUndefined();
  });

  it("does not route the backlog when sorting is paused", async () => {
    armedSyncState();
    withBacklogThread("bk-1");
    vi.mocked(db.gmailSyncSettings.findUnique).mockResolvedValue({
      includeSpam: false,
      includePromotions: false,
      sortingPaused: true,
      blacklistedSenderEmails: [],
    } as never);

    createSyncInboxWorker();
    await getProcessor()(makeJob({ workspaceId: WS_ID }));

    expect(armedBacklogCall()).toBeUndefined();
  });
});

// ─── Recovery is non-fatal to sync ──────────────────────────────────────────────

describe("createSyncInboxWorker — recovery non-fatal", () => {
  it("still resolves when a recovery query throws", async () => {
    // emailThread.findMany backs all three recovery helpers; reject it so each
    // recovery step throws. The sync must still resolve (recovery is guarded).
    vi.mocked(db.emailThread.findMany).mockRejectedValue(new Error("db down"));
    vi.mocked(resolveInboxQuota).mockResolvedValue(quotaUsed(0));

    createSyncInboxWorker();
    const processor = getProcessor();
    await expect(processor(makeJob({ workspaceId: WS_ID }))).resolves.toBeUndefined();

    // The main sync work still committed: the cursor advanced.
    expect(db.providerSyncState.update).toHaveBeenCalled();
  });
});

// ─── Disconnect-awareness ─────────────────────────────────────────────────────

describe("createSyncInboxWorker — disconnect-awareness", () => {
  it("returns gracefully when connection status is not ACTIVE", async () => {
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue({
      provider: "GMAIL",
      emailAddress: "test@gmail.com",
      subjectId: "sub-1",
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
    mockListHistory.mockResolvedValue({ changedThreadIds: [], newCursor: "hist-2" });
    vi.mocked(db.providerSyncState.upsert).mockResolvedValue({
      historyId: "hist-1",
      backfillStatus: "RUNNING",
      backfillStartedAt: staleDate,
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
    mockListHistory.mockResolvedValue({ changedThreadIds: [], newCursor: "hist-2" });
    vi.mocked(db.providerSyncState.upsert).mockResolvedValue({
      historyId: "hist-1",
      backfillStatus: "PENDING",
      backfillStartedAt: null,
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
    mockListHistory.mockResolvedValue({ changedThreadIds: [], newCursor: "hist-2" });
    vi.mocked(db.providerSyncState.upsert).mockResolvedValue({
      historyId: "hist-1",
      backfillStatus: "RUNNING",
      backfillStartedAt: freshDate,
    } as never);

    createSyncInboxWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID }));

    const { backfillInboxQueue } = await import("../queues.js");
    expect(vi.mocked(backfillInboxQueue.add)).not.toHaveBeenCalled();
  });
});

describe("createSyncInboxWorker — first-run bootstrap", () => {
  it("on first sync (no cursor) establishes the historyId only and imports zero threads", async () => {
    // No stored cursor yet → first run. backfill is PENDING (resumable) so the
    // historical import is the single source of threads.
    vi.mocked(db.providerSyncState.upsert).mockResolvedValue({
      historyId: null,
      backfillStatus: "PENDING",
      backfillStartedAt: null,
      backfillRoutingStartedAt: null,
    } as never);

    createSyncInboxWorker();
    await getProcessor()(makeJob({ workspaceId: WS_ID }));

    // The date-blind 50-thread seed must NOT run on first sync.
    expect(mockListRecentThreadIds).not.toHaveBeenCalled();
    // Cursor is established from the profile, with no threads fetched or upserted.
    expect(mockGetProfile).toHaveBeenCalled();
    expect(mockGetThread).not.toHaveBeenCalled();
    expect(vi.mocked(db.emailThread.upsert)).not.toHaveBeenCalled();

    // The cursor is advanced to the profile's historyId.
    const cursorWrite = vi.mocked(db.providerSyncState.update).mock.calls.find(
      (c) => (c[0] as { data: { historyId?: string } }).data?.historyId === "hist-2"
    );
    expect(cursorWrite).toBeDefined();

    // The historical backfill is enqueued as the single importer.
    const { backfillInboxQueue } = await import("../queues.js");
    expect(vi.mocked(backfillInboxQueue.add)).toHaveBeenCalledWith(
      "backfill-inbox",
      { workspaceId: WS_ID },
      expect.objectContaining({ deduplication: { id: `backfill-inbox_${WS_ID}` } })
    );
  });

  it("on a cursor-expired resync still seeds the 50 most-recent threads (gap catch-up)", async () => {
    // Established inbox: cursor exists but Gmail rejects it as expired. backfill is
    // long DONE and will not re-run, so the seed is intentionally kept here.
    vi.mocked(db.providerSyncState.upsert).mockResolvedValue({
      historyId: "hist-old",
      backfillStatus: "DONE",
      backfillStartedAt: null,
      backfillRoutingStartedAt: new Date(),
    } as never);
    mockListHistory.mockRejectedValue(new GmailHistoryCursorExpiredError("expired"));
    mockListRecentThreadIds.mockResolvedValue(["gmail-t1"]);

    createSyncInboxWorker();
    await getProcessor()(makeJob({ workspaceId: WS_ID }));

    // The seed runs and the recovered thread is fetched + upserted (catch-up).
    expect(mockListRecentThreadIds).toHaveBeenCalledWith(50);
    expect(mockGetThread).toHaveBeenCalledWith("gmail-t1");
    expect(vi.mocked(db.emailThread.upsert)).toHaveBeenCalled();
  });
});

// ─── Thread-fetch errors and cursor safety (finding #9) ───────────────────────
//
// Deleted threads are detected by TYPE (MailThreadNotFoundError), never by
// matching "not found" in an error message. Everything else propagates so the
// job fails before the step-6 cursor write and BullMQ retries from the same
// historyId — a changed thread is never silently lost.

describe("createSyncInboxWorker — thread-fetch errors and cursor safety", () => {
  /** The step-6 cursor write: the only providerSyncState.update carrying historyId. */
  function cursorAdvance() {
    return vi.mocked(db.providerSyncState.update).mock.calls.find(
      (c) => (c[0] as { data: { historyId?: string } }).data?.historyId !== undefined
    );
  }

  it("propagates a transient error whose message contains 'not found' instead of swallowing it, leaving the cursor untouched", async () => {
    // Not a provider 404 — e.g. a gateway/proxy error that happens to say "not found".
    mockGetThread.mockRejectedValue(new Error("upstream host not found (transient DNS failure)"));

    createSyncInboxWorker();
    const processor = getProcessor();
    await expect(processor(makeJob({ workspaceId: WS_ID }))).rejects.toThrow(
      /upstream host not found/
    );

    // No cursor advance and no classify enqueue: BullMQ retries from the same
    // historyId, so the changed thread is re-discovered instead of lost.
    expect(cursorAdvance()).toBeUndefined();
    expect(classifyThreadQueue.addBulk).not.toHaveBeenCalled();
  });

  it("skips a thread the provider definitively reports as gone (typed not-found) and still advances the cursor", async () => {
    mockListHistory.mockResolvedValue({
      changedThreadIds: ["gmail-gone", "gmail-t2"],
      newCursor: "hist-2",
    });
    mockGetThread.mockImplementation((id: string) =>
      id === "gmail-gone"
        ? Promise.reject(new GmailThreadNotFoundError("Gmail thread not found: gmail-gone"))
        : Promise.resolve({ id })
    );

    createSyncInboxWorker();
    const processor = getProcessor();
    await expect(processor(makeJob({ workspaceId: WS_ID }))).resolves.toBeUndefined();

    // Only the surviving thread was upserted; advancing past a deleted thread is correct.
    expect(vi.mocked(db.emailThread.upsert)).toHaveBeenCalledOnce();
    const advance = cursorAdvance();
    expect(advance).toBeDefined();
    expect((advance![0] as { data: { historyId: string } }).data.historyId).toBe("hist-2");
  });

  it("does not advance the cursor when a transient error occurs mid-batch", async () => {
    mockListHistory.mockResolvedValue({
      changedThreadIds: ["gmail-t1", "gmail-t2"],
      newCursor: "hist-2",
    });
    mockGetThread.mockImplementation((id: string) =>
      id === "gmail-t2"
        ? Promise.reject(new Error("Gmail thread fetch failed: 503"))
        : Promise.resolve({ id })
    );

    createSyncInboxWorker();
    const processor = getProcessor();
    await expect(processor(makeJob({ workspaceId: WS_ID }))).rejects.toThrow(/503/);

    // The first thread was processed (the retry re-diffs it idempotently), but
    // the cursor stayed put so the failed thread is re-attempted.
    expect(vi.mocked(db.emailThread.upsert)).toHaveBeenCalledOnce();
    expect(cursorAdvance()).toBeUndefined();
  });
});

describe("createSyncInboxWorker — sent-only threads", () => {
  // clearAllMocks (top-level beforeEach) resets call history but not implementations,
  // so a rejection set by an earlier test can leak in. Restore the clean default.
  beforeEach(() => {
    vi.mocked(db.emailThread.findMany).mockResolvedValue([] as never);
  });

  /** The step-6 cursor write: the only providerSyncState.update carrying historyId. */
  function cursorAdvance() {
    return vi.mocked(db.providerSyncState.update).mock.calls.find(
      (c) => (c[0] as { data: { historyId?: string } }).data?.historyId !== undefined
    );
  }

  it("skips a sent-only candidate that was never imported — no fetch, no row, cursor advances", async () => {
    mockListHistory.mockResolvedValue({
      changedThreadIds: ["gmail-sent"],
      removedMessageIds: [],
      sentOnlyCandidateThreadIds: ["gmail-sent"],
      newCursor: "hist-2",
    });
    // Default emailThread.findMany → [] : the candidate is not in the DB.

    createSyncInboxWorker();
    await getProcessor()(makeJob({ workspaceId: WS_ID }));

    expect(mockGetThread).not.toHaveBeenCalled();
    expect(db.emailThread.upsert).not.toHaveBeenCalled();
    expect(classifyThreadQueue.addBulk).not.toHaveBeenCalled();
    const advance = cursorAdvance();
    expect(advance).toBeDefined();
    expect((advance![0] as { data: { historyId: string } }).data.historyId).toBe("hist-2");
  });

  it("processes a sent-only candidate that IS already imported (user replied from Gmail)", async () => {
    mockListHistory.mockResolvedValue({
      changedThreadIds: ["gmail-reply"],
      removedMessageIds: [],
      sentOnlyCandidateThreadIds: ["gmail-reply"],
      newCursor: "hist-2",
    });
    // The candidate-existence lookup finds the thread; recovery lookups (no
    // providerThreadId filter) still return nothing.
    vi.mocked(db.emailThread.findMany).mockImplementation((async (args: {
      where?: { providerThreadId?: unknown };
    }) => (args?.where?.providerThreadId ? [{ providerThreadId: "gmail-reply" }] : [])) as never);
    mockGetThread.mockResolvedValue({ id: "gmail-reply" });

    createSyncInboxWorker();
    await getProcessor()(makeJob({ workspaceId: WS_ID }));

    // Fetched, upserted, and re-sorted — the reply must not be dropped.
    expect(mockGetThread).toHaveBeenCalledWith("gmail-reply");
    expect(db.emailThread.upsert).toHaveBeenCalledOnce();
    expect(classifyThreadQueue.addBulk).toHaveBeenCalledOnce();
  });

  it("imports the full thread once the counterpart replies (skip then import)", async () => {
    // Cycle 1: the user's send is a candidate and the thread is not imported yet.
    mockListHistory.mockResolvedValueOnce({
      changedThreadIds: ["gmail-x"],
      removedMessageIds: [],
      sentOnlyCandidateThreadIds: ["gmail-x"],
      newCursor: "hist-2",
    });
    createSyncInboxWorker();
    await getProcessor()(makeJob({ workspaceId: WS_ID }));
    expect(mockGetThread).not.toHaveBeenCalled();

    // Cycle 2: an inbound reply arrives — the thread is no longer a candidate.
    mockGetThread.mockClear();
    mockListHistory.mockResolvedValueOnce({
      changedThreadIds: ["gmail-x"],
      removedMessageIds: [],
      sentOnlyCandidateThreadIds: [],
      newCursor: "hist-3",
    });
    mockGetThread.mockResolvedValue({ id: "gmail-x" });
    createSyncInboxWorker();
    await getProcessor()(makeJob({ workspaceId: WS_ID }));

    expect(mockGetThread).toHaveBeenCalledWith("gmail-x");
    expect(db.emailThread.upsert).toHaveBeenCalledOnce();
  });

  it("fetches every changed thread when the provider omits the sent-only hint (Outlook shape)", async () => {
    mockListHistory.mockResolvedValue({
      changedThreadIds: ["gmail-t1"],
      removedMessageIds: [],
      newCursor: "hist-2",
    });

    createSyncInboxWorker();
    await getProcessor()(makeJob({ workspaceId: WS_ID }));

    expect(mockGetThread).toHaveBeenCalledWith("gmail-t1");
  });

  it("skips an owner-sent thread the Gmail labels failed to flag (the prod regression)", async () => {
    // Reproduces prod: the send is NOT a label-based candidate (its message
    // carried INBOX, so the SENT-without-INBOX hint never fired), so it is
    // fetched. The identity-based backstop must still drop it: the owner is the
    // sole sender and not a recipient.
    mockListHistory.mockResolvedValue({
      changedThreadIds: ["gmail-sent-inbox"],
      removedMessageIds: [],
      sentOnlyCandidateThreadIds: [],
      newCursor: "hist-2",
    });
    mockGetThread.mockResolvedValue({
      id: "gmail-sent-inbox",
      senderEmail: "test@gmail.com",
      labelIds: ["SENT", "INBOX"],
    });

    createSyncInboxWorker();
    await getProcessor()(makeJob({ workspaceId: WS_ID }));

    expect(mockGetThread).toHaveBeenCalledWith("gmail-sent-inbox"); // fetched (no label hint)
    expect(db.emailThread.upsert).not.toHaveBeenCalled(); // but never imported
    expect(classifyThreadQueue.addBulk).not.toHaveBeenCalled(); // and never classified
  });

  it("snapshot backstop on the cursor-expired fallback: skips sent-only, imports the rest", async () => {
    mockListHistory.mockRejectedValue(new GmailHistoryCursorExpiredError("cursor expired"));
    mockGetProfile.mockResolvedValue({ syncCursor: "hist-9" });
    mockListRecentThreadIds.mockResolvedValue(["sent-x", "inbound-y"]);
    mockGetThread.mockImplementation((id: string) =>
      id === "sent-x"
        ? Promise.resolve({ id, senderEmail: "test@gmail.com", labelIds: ["SENT"] })
        : Promise.resolve({ id, senderEmail: "sender@example.com", labelIds: ["INBOX"] })
    );
    // Neither thread is in the DB (findUnique → null default), so the sent-only
    // one is dropped without a row.

    createSyncInboxWorker();
    await getProcessor()(makeJob({ workspaceId: WS_ID }));

    // Both fetched (no label hint on the fallback path), but only the inbound one
    // is imported.
    expect(mockGetThread).toHaveBeenCalledWith("sent-x");
    expect(mockGetThread).toHaveBeenCalledWith("inbound-y");
    expect(db.emailThread.upsert).toHaveBeenCalledOnce();
    const upsertArg = vi.mocked(db.emailThread.upsert).mock.calls[0]![0] as {
      create: { providerThreadId: string };
    };
    expect(upsertArg.create.providerThreadId).toBe("inbound-y");
  });
});
