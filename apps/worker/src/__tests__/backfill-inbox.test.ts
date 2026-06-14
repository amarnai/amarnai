import { vi, describe, it, expect, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@amarnai/db", () => ({
  db: {
    workspace: { findUnique: vi.fn() },
    gmailConnection: { findUnique: vi.fn() },
    gmailSyncSettings: { findUnique: vi.fn() },
    emailAccount: { findUnique: vi.fn() },
    providerSyncState: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    taxonomyNode: { findMany: vi.fn() },
    taxonomyEdge: { findMany: vi.fn() },
    emailThread: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    emailMessage: {
      upsert: vi.fn(),
    },
  },
}));

const mockListThreadsPage = vi.fn();
const mockGetThread = vi.fn();
const mockListThreadIdsByQuery = vi.fn().mockResolvedValue([]);

vi.mock("@amarnai/gmail", () => ({
  GmailAuthError: class GmailAuthError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "GmailAuthError";
    }
  },
  GmailClient: vi.fn().mockImplementation(() => ({
    listThreadsPage: mockListThreadsPage,
    getThread: mockGetThread,
    listThreadIdsByQuery: mockListThreadIdsByQuery,
  })),
  normalizeGmailThread: vi.fn().mockImplementation((raw: unknown) => {
    const r = raw as { id: string; subject?: string };
    return {
      providerThreadId: r.id,
      subject: r.subject ?? null,
      latestMessageAt: new Date(),
      messageCount: 1,
      messages: [
        {
          providerMessageId: `msg-${r.id}`,
          senderEmail: "sender@example.com",
          senderName: "Sender",
          toEmails: [],
          ccEmails: [],
          subject: r.subject ?? null,
          bodyExcerpt: "snippet",
          receivedAt: new Date(),
          attachments: [],
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

// queues.js mock — use inline vi.fn() so there's no hoisting issue.
vi.mock("../queues.js", () => ({
  classifyThreadQueue: { addBulk: vi.fn().mockResolvedValue([]) },
  backfillInboxQueue: { add: vi.fn(), close: vi.fn() },
  QUEUE_BACKFILL_INBOX: "backfill-inbox",
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import { db } from "@amarnai/db";
import { GmailAuthError } from "@amarnai/gmail";
import { Worker } from "bullmq";
import { classifyThreadQueue } from "../queues.js";
import { createBackfillInboxWorker } from "../jobs/backfill-inbox.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const WS_ID = "ws-1";
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

/** Build a fake GmailThreadMeta. */
function makeGmailThread(opts: {
  id: string;
  unread?: boolean;
  daysAgo?: number;
}): { id: string; unread: boolean; latestMessageAt: Date } {
  const msAgo = (opts.daysAgo ?? 1) * 24 * 60 * 60 * 1_000;
  return {
    id: opts.id,
    unread: opts.unread ?? false,
    latestMessageAt: new Date(Date.now() - msAgo),
  };
}

/** Extract the processor function captured by the mocked Worker constructor. */
function getProcessor(): (job: unknown) => Promise<void> {
  const WorkerMock = vi.mocked(Worker);
  const lastCall = WorkerMock.mock.calls[WorkerMock.mock.calls.length - 1];
  // Second arg is the processor.
  return lastCall?.[1] as (job: unknown) => Promise<void>;
}

/** Minimal fake BullMQ job. */
function makeJob(data: Record<string, string>) {
  return { data, updateProgress: vi.fn() };
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  // Default workspace + connection stubs. PRO/MONTHLY → 10,000-thread cap,
  // full history (no time window).
  vi.mocked(db.workspace.findUnique).mockResolvedValue({
    ownerUserId: "user-1",
    plan: "PRO",
    billingCycle: "MONTHLY",
  } as never);
  vi.mocked(db.gmailConnection.findUnique).mockResolvedValue({
    gmailAddress: "test@gmail.com",
    googleSubjectId: "google-sub-1",
    encryptedRefreshToken: "enc-token",
    status: "ACTIVE",
  } as never);
  // No settings row → defaults apply (includeSpam: false, includePromotions: false).
  vi.mocked(db.gmailSyncSettings.findUnique).mockResolvedValue(null);
  vi.mocked(db.emailAccount.findUnique).mockResolvedValue({
    id: "account-1",
  } as never);
  vi.mocked(db.providerSyncState.update).mockResolvedValue({} as never);
  // Default: the atomic claim and every progress write succeed (count 1).
  vi.mocked(db.providerSyncState.updateMany).mockResolvedValue({ count: 1 } as never);
  vi.mocked(db.emailThread.upsert).mockResolvedValue({ id: "thread-db-1" } as never);
  vi.mocked(db.emailMessage.upsert).mockResolvedValue({} as never);
  mockGetThread.mockResolvedValue({ id: "gmail-1" });

  // Re-attach the mock on classifyThreadQueue.addBulk after clearAllMocks.
  vi.mocked(classifyThreadQueue.addBulk).mockResolvedValue([]);

  // Default: taxonomy is strong enough (3 non-root nodes all linked to root).
  vi.mocked(db.taxonomyNode.findMany).mockResolvedValue(makeNodes(3) as never);
  vi.mocked(db.taxonomyEdge.findMany).mockResolvedValue(makeEdges(3) as never);
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("createBackfillInboxWorker", () => {
  it("(a) returns early without any DB writes when backfillStatus is DONE", async () => {
    vi.mocked(db.providerSyncState.findUnique).mockResolvedValue({
      backfillStatus: "DONE",
    } as never);

    createBackfillInboxWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID }));

    // Only findUnique should have been called — no claim/write, no Gmail calls.
    expect(db.providerSyncState.updateMany).not.toHaveBeenCalled();
    expect(mockListThreadsPage).not.toHaveBeenCalled();
    expect(classifyThreadQueue.addBulk).not.toHaveBeenCalled();
  });

  it("(a) skips when the atomic claim is lost (already running elsewhere)", async () => {
    vi.mocked(db.providerSyncState.findUnique).mockResolvedValue({
      backfillStatus: "RUNNING",
      backfillStartedAt: new Date(), // fresh — claim should not be won
    } as never);
    // The conditional claim matches no row (another worker holds it).
    vi.mocked(db.providerSyncState.updateMany).mockResolvedValue({ count: 0 } as never);

    createBackfillInboxWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID }));

    // Claim attempted, but processing never started.
    expect(mockListThreadsPage).not.toHaveBeenCalled();
    expect(classifyThreadQueue.addBulk).not.toHaveBeenCalled();
  });

  it("(b) enqueues classify jobs with unread threads first, then by recency", async () => {
    vi.mocked(db.providerSyncState.findUnique).mockResolvedValue({
      backfillStatus: "PENDING",
      backfillStartedAt: null,
    } as never);

    // Three threads: one read-old, one unread-mid, one read-new.
    // Expected order: unread-mid → read-new → read-old.
    const threads = [
      makeGmailThread({ id: "read-old", unread: false, daysAgo: 10 }),
      makeGmailThread({ id: "unread-mid", unread: true, daysAgo: 5 }),
      makeGmailThread({ id: "read-new", unread: false, daysAgo: 1 }),
    ];

    mockListThreadsPage.mockResolvedValue({ threads, nextPageToken: undefined });

    // All threads are new (not yet in DB).
    vi.mocked(db.emailThread.findUnique).mockResolvedValue(null);
    mockGetThread.mockImplementation(async (id: string) => ({ id }));
    vi.mocked(db.emailThread.upsert).mockImplementation(
      (({ create }: { create: { providerThreadId: string } }) =>
        Promise.resolve({ id: `db-${create.providerThreadId}` })) as never
    );

    createBackfillInboxWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID }));

    expect(classifyThreadQueue.addBulk).toHaveBeenCalledOnce();
    const bulkJobs = vi.mocked(classifyThreadQueue.addBulk).mock.calls[0]![0] as Array<{
      opts: { priority: number };
      data: { emailThreadId: string };
    }>;

    // All jobs should have backfill priority (10).
    expect(bulkJobs.every((j) => j.opts.priority === 10)).toBe(true);

    // Verify ordering of internal thread IDs.
    const orderedIds = bulkJobs.map((j) => j.data.emailThreadId);
    const unreadIdx = orderedIds.indexOf("db-unread-mid");
    const readNewIdx = orderedIds.indexOf("db-read-new");
    const readOldIdx = orderedIds.indexOf("db-read-old");

    expect(unreadIdx).toBeLessThan(readNewIdx);
    expect(unreadIdx).toBeLessThan(readOldIdx);
    // Among read threads, newer should come before older.
    expect(readNewIdx).toBeLessThan(readOldIdx);
  });

  // ── Plan-derived caps ───────────────────────────────────────────────────────

  it("(c2) scans full history for a paid plan (afterMs 0)", async () => {
    vi.mocked(db.providerSyncState.findUnique).mockResolvedValue({
      backfillStatus: "PENDING",
      backfillStartedAt: null,
    } as never);
    mockListThreadsPage.mockResolvedValue({ threads: [], nextPageToken: undefined });

    createBackfillInboxWorker();
    await getProcessor()(makeJob({ workspaceId: WS_ID }));

    expect(mockListThreadsPage).toHaveBeenCalledWith(
      expect.objectContaining({ afterMs: 0 })
    );
  });

  it("(c3) bounds the Free plan to a 30-day window", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({
      ownerUserId: "user-1",
      plan: "FREE",
      billingCycle: null,
    } as never);
    vi.mocked(db.providerSyncState.findUnique).mockResolvedValue({
      backfillStatus: "PENDING",
      backfillStartedAt: null,
    } as never);
    mockListThreadsPage.mockResolvedValue({ threads: [], nextPageToken: undefined });

    const before = Date.now() - 30 * 24 * 60 * 60 * 1_000;
    createBackfillInboxWorker();
    await getProcessor()(makeJob({ workspaceId: WS_ID }));
    const after = Date.now() - 30 * 24 * 60 * 60 * 1_000;

    const arg = mockListThreadsPage.mock.calls[0]![0] as { afterMs: number };
    expect(arg.afterMs).toBeGreaterThanOrEqual(before);
    expect(arg.afterMs).toBeLessThanOrEqual(after);
  });

  it("(c4) stops at the plan cap when more threads exist (Free → 500)", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({
      ownerUserId: "user-1",
      plan: "FREE",
      billingCycle: null,
    } as never);
    vi.mocked(db.providerSyncState.findUnique).mockResolvedValue({
      backfillStatus: "PENDING",
      backfillStartedAt: null,
    } as never);

    // Every page is full and always has a next page → effectively infinite.
    const fullPage = Array.from({ length: 100 }, (_, i) => makeGmailThread({ id: `t-${i}` }));
    mockListThreadsPage.mockResolvedValue({ threads: fullPage, nextPageToken: "more" });
    vi.mocked(db.emailThread.findUnique).mockResolvedValue(null);
    mockGetThread.mockImplementation(async (id: string) => ({ id }));
    vi.mocked(db.emailThread.upsert).mockResolvedValue({ id: "db-x" } as never);

    createBackfillInboxWorker();
    await getProcessor()(makeJob({ workspaceId: WS_ID }));

    // Free cap is 500 → exactly 5 pages of 100, then it stops (cap reached = done).
    expect(mockListThreadsPage).toHaveBeenCalledTimes(5);
    const doneCall = vi.mocked(db.providerSyncState.updateMany).mock.calls.find(
      (c) => (c[0] as { data: { backfillStatus?: string } }).data?.backfillStatus === "DONE"
    );
    expect(doneCall).toBeDefined();
    const doneData = (doneCall![0] as { data: { backfillProcessedCount: number } }).data;
    expect(doneData.backfillProcessedCount).toBe(500);
  });

  // ── Chunked continuation ──────────────────────────────────────────────────────

  it("(c5) persists the cursor and re-enqueues when more remains after a chunk", async () => {
    // PRO cap is 10,000; one run processes BACKFILL_CHUNK_THREADS (500) then stops.
    vi.mocked(db.providerSyncState.findUnique).mockResolvedValue({
      backfillStatus: "PENDING",
      backfillStartedAt: null,
      backfillPageToken: null,
      backfillProcessedCount: 0,
    } as never);

    const fullPage = Array.from({ length: 100 }, (_, i) => makeGmailThread({ id: `t-${i}` }));
    mockListThreadsPage.mockResolvedValue({ threads: fullPage, nextPageToken: "next-cursor" });
    vi.mocked(db.emailThread.findUnique).mockResolvedValue(null);
    mockGetThread.mockImplementation(async (id: string) => ({ id }));
    vi.mocked(db.emailThread.upsert).mockResolvedValue({ id: "db-x" } as never);

    const { backfillInboxQueue } = await import("../queues.js");

    createBackfillInboxWorker();
    await getProcessor()(makeJob({ workspaceId: WS_ID }));

    // Did NOT finish.
    const doneCall = vi.mocked(db.providerSyncState.updateMany).mock.calls.find(
      (c) => (c[0] as { data: { backfillStatus?: string } }).data?.backfillStatus === "DONE"
    );
    expect(doneCall).toBeUndefined();

    // Persisted the cursor + progress, leaving status RUNNING with a cleared lock.
    const cursorCall = vi.mocked(db.providerSyncState.updateMany).mock.calls.find(
      (c) => (c[0] as { data: { backfillPageToken?: string } }).data?.backfillPageToken === "next-cursor"
    );
    expect(cursorCall).toBeDefined();
    const cursorData = (cursorCall![0] as {
      data: { backfillStatus: string; backfillStartedAt: unknown; backfillProcessedCount: number };
    }).data;
    expect(cursorData.backfillStatus).toBe("RUNNING");
    expect(cursorData.backfillStartedAt).toBeNull();
    expect(cursorData.backfillProcessedCount).toBe(500);

    // Re-enqueued a continuation (without deduplication).
    expect(vi.mocked(backfillInboxQueue.add)).toHaveBeenCalledWith("backfill-inbox", { workspaceId: WS_ID });
  });

  it("(c6) resumes from the persisted pageToken and processed count", async () => {
    // PRO cap 10,000; resume at 9,950 processed → only 50 left before DONE.
    vi.mocked(db.providerSyncState.findUnique).mockResolvedValue({
      backfillStatus: "RUNNING",
      backfillStartedAt: null,
      backfillPageToken: "resume-here",
      backfillProcessedCount: 9_950,
    } as never);

    const fullPage = Array.from({ length: 100 }, (_, i) => makeGmailThread({ id: `t-${i}` }));
    mockListThreadsPage.mockResolvedValue({ threads: fullPage, nextPageToken: "ignored" });
    vi.mocked(db.emailThread.findUnique).mockResolvedValue(null);
    mockGetThread.mockImplementation(async (id: string) => ({ id }));
    vi.mocked(db.emailThread.upsert).mockResolvedValue({ id: "db-x" } as never);

    createBackfillInboxWorker();
    await getProcessor()(makeJob({ workspaceId: WS_ID }));

    // First fetch resumes from the persisted cursor.
    expect(mockListThreadsPage).toHaveBeenCalledWith(
      expect.objectContaining({ pageToken: "resume-here" })
    );
    // Cap reached (9,950 + 50) → DONE with the final count.
    const doneCall = vi.mocked(db.providerSyncState.updateMany).mock.calls.find(
      (c) => (c[0] as { data: { backfillStatus?: string } }).data?.backfillStatus === "DONE"
    );
    expect(doneCall).toBeDefined();
    const doneData = (doneCall![0] as { data: { backfillProcessedCount: number } }).data;
    expect(doneData.backfillProcessedCount).toBe(10_000);
  });

  // ── Per-thread error handling ─────────────────────────────────────────────────

  it("(f) skips a thread that fails with a permanent error and still completes", async () => {
    vi.mocked(db.providerSyncState.findUnique).mockResolvedValue({
      backfillStatus: "PENDING",
      backfillStartedAt: null,
      backfillPageToken: null,
      backfillProcessedCount: 0,
      backfillSkipped: 0,
    } as never);

    const good = makeGmailThread({ id: "good" });
    const bad = makeGmailThread({ id: "bad" });
    mockListThreadsPage.mockResolvedValue({ threads: [good, bad], nextPageToken: undefined });
    vi.mocked(db.emailThread.findUnique).mockResolvedValue(null);
    mockGetThread.mockImplementation(async (id: string) => {
      if (id === "bad") throw new Error("Gmail thread fetch failed: 400");
      return { id };
    });
    vi.mocked(db.emailThread.upsert).mockResolvedValue({ id: "db-good" } as never);

    createBackfillInboxWorker();
    await getProcessor()(makeJob({ workspaceId: WS_ID }));

    // Finished despite the bad thread, recording it as skipped.
    const doneCall = vi.mocked(db.providerSyncState.updateMany).mock.calls.find(
      (c) => (c[0] as { data: { backfillStatus?: string } }).data?.backfillStatus === "DONE"
    );
    expect(doneCall).toBeDefined();
    const doneData = (doneCall![0] as { data: { backfillSkipped: number } }).data;
    expect(doneData.backfillSkipped).toBe(1);

    // The good thread was still enqueued for classification.
    expect(classifyThreadQueue.addBulk).toHaveBeenCalledOnce();
    const [bulkJobs] = vi.mocked(classifyThreadQueue.addBulk).mock.calls[0]!;
    expect((bulkJobs as unknown[]).length).toBe(1);
  });

  it("(g) aborts with ERROR (not skip) on a transient fetch error", async () => {
    vi.mocked(db.providerSyncState.findUnique).mockResolvedValue({
      backfillStatus: "PENDING",
      backfillStartedAt: null,
      backfillPageToken: null,
      backfillProcessedCount: 0,
      backfillSkipped: 0,
    } as never);

    const bad = makeGmailThread({ id: "bad" });
    mockListThreadsPage.mockResolvedValue({ threads: [bad], nextPageToken: undefined });
    vi.mocked(db.emailThread.findUnique).mockResolvedValue(null);
    mockGetThread.mockRejectedValue(new Error("Gmail thread fetch failed: 429"));

    createBackfillInboxWorker();
    await expect(getProcessor()(makeJob({ workspaceId: WS_ID }))).rejects.toThrow("429");

    const errorCall = vi.mocked(db.providerSyncState.updateMany).mock.calls.find(
      (c) => (c[0] as { data: { backfillStatus?: string } }).data?.backfillStatus === "ERROR"
    );
    expect(errorCall).toBeDefined();
    const doneCall = vi.mocked(db.providerSyncState.updateMany).mock.calls.find(
      (c) => (c[0] as { data: { backfillStatus?: string } }).data?.backfillStatus === "DONE"
    );
    expect(doneCall).toBeUndefined();
  });

  it("(h) aborts on an auth error rather than skipping the whole inbox", async () => {
    vi.mocked(db.providerSyncState.findUnique).mockResolvedValue({
      backfillStatus: "PENDING",
      backfillStartedAt: null,
      backfillPageToken: null,
      backfillProcessedCount: 0,
      backfillSkipped: 0,
    } as never);

    const bad = makeGmailThread({ id: "bad" });
    mockListThreadsPage.mockResolvedValue({ threads: [bad], nextPageToken: undefined });
    vi.mocked(db.emailThread.findUnique).mockResolvedValue(null);
    mockGetThread.mockRejectedValue(new GmailAuthError("Token refresh failed: invalid_grant"));

    createBackfillInboxWorker();
    await expect(getProcessor()(makeJob({ workspaceId: WS_ID }))).rejects.toThrow();

    const doneCall = vi.mocked(db.providerSyncState.updateMany).mock.calls.find(
      (c) => (c[0] as { data: { backfillStatus?: string } }).data?.backfillStatus === "DONE"
    );
    expect(doneCall).toBeUndefined();
  });

  // ── Concurrency: atomic claim + generation guard ──────────────────────────────

  it("(i) hands off without marking DONE when superseded by a reset mid-run", async () => {
    vi.mocked(db.providerSyncState.findUnique).mockResolvedValue({
      backfillStatus: "PENDING",
      backfillStartedAt: null,
      backfillPageToken: null,
      backfillProcessedCount: 0,
      backfillSkipped: 0,
      backfillGeneration: 7,
    } as never);
    // Claim wins (count 1), but the generation-guarded final write matches
    // nothing (a sweep bumped the generation while we were running).
    vi.mocked(db.providerSyncState.updateMany)
      .mockResolvedValueOnce({ count: 1 } as never) // claim
      .mockResolvedValue({ count: 0 } as never); // superseded final write

    mockListThreadsPage.mockResolvedValue({
      threads: [makeGmailThread({ id: "t1" })],
      nextPageToken: undefined,
    });
    vi.mocked(db.emailThread.findUnique).mockResolvedValue(null);
    mockGetThread.mockResolvedValue({ id: "t1" });
    vi.mocked(db.emailThread.upsert).mockResolvedValue({ id: "db-t1" } as never);

    const { backfillInboxQueue } = await import("../queues.js");

    createBackfillInboxWorker();
    await getProcessor()(makeJob({ workspaceId: WS_ID }));

    // The final write was superseded, so it must NOT have committed a DONE that
    // overwrites the reset — and it hands the work off to a fresh run.
    expect(vi.mocked(backfillInboxQueue.add)).toHaveBeenCalledWith("backfill-inbox", {
      workspaceId: WS_ID,
    });
  });

  it("(j) resumes from the cursor read AFTER the claim, not the one read before", async () => {
    // First read (pre-claim, status short-circuit) carries a STALE cursor; the
    // second read (post-claim, authoritative) carries a FRESH cursor. The run
    // must use the fresh one — proving the cursor is read after winning the claim.
    vi.mocked(db.providerSyncState.findUnique)
      .mockResolvedValueOnce({
        backfillStatus: "PENDING",
        backfillPageToken: "STALE",
        backfillProcessedCount: 0,
        backfillSkipped: 0,
        backfillGeneration: 0,
      } as never)
      .mockResolvedValue({
        backfillStatus: "PENDING",
        backfillPageToken: "FRESH",
        backfillProcessedCount: 0,
        backfillSkipped: 0,
        backfillGeneration: 0,
      } as never);
    // Claim succeeds (default count 1).
    mockListThreadsPage.mockResolvedValue({ threads: [], nextPageToken: undefined });

    createBackfillInboxWorker();
    await getProcessor()(makeJob({ workspaceId: WS_ID }));

    expect(mockListThreadsPage).toHaveBeenCalledWith(
      expect.objectContaining({ pageToken: "FRESH" })
    );
  });

  // ── Taxonomy gate ─────────────────────────────────────────────────────────

  it("(d) leaves threads PENDING and does not enqueue when routable count < threshold", async () => {
    vi.mocked(db.providerSyncState.findUnique).mockResolvedValue({
      backfillStatus: "PENDING",
      backfillStartedAt: null,
    } as never);
    vi.mocked(db.taxonomyNode.findMany).mockResolvedValue(makeNodes(2) as never);
    vi.mocked(db.taxonomyEdge.findMany).mockResolvedValue(makeEdges(2) as never);

    const thread = makeGmailThread({ id: "t1" });
    mockListThreadsPage.mockResolvedValue({ threads: [thread], nextPageToken: undefined });
    vi.mocked(db.emailThread.findUnique).mockResolvedValue(null);
    mockGetThread.mockResolvedValue({ id: "t1" });
    vi.mocked(db.emailThread.upsert).mockResolvedValue({ id: "db-t1" } as never);

    createBackfillInboxWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID }));

    const calls = vi.mocked(db.emailThread.updateMany).mock.calls;
    const unroutedCall = calls.find(
      (c) => (c[0] as { data: { triageStatus?: string } }).data?.triageStatus === "UNROUTED"
    );
    expect(unroutedCall).toBeUndefined();
    expect(classifyThreadQueue.addBulk).not.toHaveBeenCalled();
  });

  it("(d2) leaves threads PENDING when nodes exist but are not linked to root", async () => {
    vi.mocked(db.providerSyncState.findUnique).mockResolvedValue({
      backfillStatus: "PENDING",
      backfillStartedAt: null,
    } as never);
    vi.mocked(db.taxonomyNode.findMany).mockResolvedValue(makeNodes(3) as never);
    vi.mocked(db.taxonomyEdge.findMany).mockResolvedValue([] as never);

    const thread = makeGmailThread({ id: "t1" });
    mockListThreadsPage.mockResolvedValue({ threads: [thread], nextPageToken: undefined });
    vi.mocked(db.emailThread.findUnique).mockResolvedValue(null);
    mockGetThread.mockResolvedValue({ id: "t1" });
    vi.mocked(db.emailThread.upsert).mockResolvedValue({ id: "db-t1" } as never);

    createBackfillInboxWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID }));

    const calls = vi.mocked(db.emailThread.updateMany).mock.calls;
    const unroutedCall = calls.find(
      (c) => (c[0] as { data: { triageStatus?: string } }).data?.triageStatus === "UNROUTED"
    );
    expect(unroutedCall).toBeUndefined();
    expect(classifyThreadQueue.addBulk).not.toHaveBeenCalled();
  });

  it("(e) enqueues classify jobs when routable count equals the threshold", async () => {
    vi.mocked(db.providerSyncState.findUnique).mockResolvedValue({
      backfillStatus: "PENDING",
      backfillStartedAt: null,
    } as never);

    const thread = makeGmailThread({ id: "t1" });
    mockListThreadsPage.mockResolvedValue({ threads: [thread], nextPageToken: undefined });
    vi.mocked(db.emailThread.findUnique).mockResolvedValue(null);
    mockGetThread.mockResolvedValue({ id: "t1" });
    vi.mocked(db.emailThread.upsert).mockResolvedValue({ id: "db-t1" } as never);

    createBackfillInboxWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID }));

    expect(classifyThreadQueue.addBulk).toHaveBeenCalledOnce();
    const [bulkJobs] = vi.mocked(classifyThreadQueue.addBulk).mock.calls[0]!;
    const calls = vi.mocked(db.emailThread.updateMany).mock.calls;
    const unroutedCall = calls.find(
      (c) => (c[0] as { data: { triageStatus?: string } }).data?.triageStatus === "UNROUTED"
    );
    expect(unroutedCall).toBeUndefined();
    expect((bulkJobs as unknown[]).length).toBeGreaterThan(0);
  });
});

// ─── Disconnect-awareness ─────────────────────────────────────────────────────

describe("createBackfillInboxWorker — disconnect-awareness", () => {
  it("returns gracefully when connection status is not ACTIVE", async () => {
    vi.mocked(db.gmailConnection.findUnique).mockResolvedValue({
      gmailAddress: "test@gmail.com",
      googleSubjectId: "google-sub-1",
      encryptedRefreshToken: "enc-token",
      status: "DISCONNECTED",
    } as never);
    vi.mocked(db.providerSyncState.findUnique).mockResolvedValue({
      backfillStatus: "PENDING",
      backfillStartedAt: null,
    } as never);

    createBackfillInboxWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID }));

    expect(db.providerSyncState.updateMany).not.toHaveBeenCalled();
    expect(mockListThreadsPage).not.toHaveBeenCalled();
    expect(classifyThreadQueue.addBulk).not.toHaveBeenCalled();
  });

  it("stamps backfillStartedAt when marking RUNNING", async () => {
    vi.mocked(db.providerSyncState.findUnique).mockResolvedValue({
      backfillStatus: "PENDING",
      backfillStartedAt: null,
    } as never);
    mockListThreadsPage.mockResolvedValue({ threads: [], nextPageToken: undefined });

    createBackfillInboxWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID }));

    const runningCall = vi.mocked(db.providerSyncState.updateMany).mock.calls.find(
      (c) => (c[0] as { data: { backfillStatus?: string } }).data?.backfillStatus === "RUNNING"
    );
    expect(runningCall).toBeDefined();
    const runningData = (runningCall![0] as { data: { backfillStartedAt: unknown } }).data;
    expect(runningData.backfillStartedAt).toBeInstanceOf(Date);
  });

  it("clears backfillStartedAt when marking DONE", async () => {
    vi.mocked(db.providerSyncState.findUnique).mockResolvedValue({
      backfillStatus: "PENDING",
      backfillStartedAt: null,
    } as never);
    mockListThreadsPage.mockResolvedValue({ threads: [], nextPageToken: undefined });

    createBackfillInboxWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID }));

    const doneCall = vi.mocked(db.providerSyncState.updateMany).mock.calls.find(
      (c) => (c[0] as { data: { backfillStatus?: string } }).data?.backfillStatus === "DONE"
    );
    expect(doneCall).toBeDefined();
    const doneData = (doneCall![0] as { data: { backfillStartedAt: unknown } }).data;
    expect(doneData.backfillStartedAt).toBeNull();
  });

  it("treats stale RUNNING as resumable and proceeds", async () => {
    const staleDate = new Date(Date.now() - 2 * 60 * 60 * 1_000); // 2 hours ago
    vi.mocked(db.providerSyncState.findUnique).mockResolvedValue({
      backfillStatus: "RUNNING",
      backfillStartedAt: staleDate,
    } as never);
    mockListThreadsPage.mockResolvedValue({ threads: [], nextPageToken: undefined });

    createBackfillInboxWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID }));

    // Should stamp RUNNING again (re-enter the backfill)
    const runningCall = vi.mocked(db.providerSyncState.updateMany).mock.calls.find(
      (c) => (c[0] as { data: { backfillStatus?: string } }).data?.backfillStatus === "RUNNING"
    );
    expect(runningCall).toBeDefined();
    // Should eventually mark DONE
    const doneCall = vi.mocked(db.providerSyncState.updateMany).mock.calls.find(
      (c) => (c[0] as { data: { backfillStatus?: string } }).data?.backfillStatus === "DONE"
    );
    expect(doneCall).toBeDefined();
  });

  it("resets to PENDING and stops when disconnected mid-loop (i=0 check)", async () => {
    vi.mocked(db.providerSyncState.findUnique).mockResolvedValue({
      backfillStatus: "PENDING",
      backfillStartedAt: null,
    } as never);

    const thread = makeGmailThread({ id: "t1" });
    mockListThreadsPage.mockResolvedValue({ threads: [thread], nextPageToken: undefined });
    vi.mocked(db.emailThread.findUnique).mockResolvedValue(null); // new thread → upsert path
    mockGetThread.mockResolvedValue({ id: "t1" });
    vi.mocked(db.emailThread.upsert).mockResolvedValue({ id: "db-t1" } as never);

    // First call (Promise.all startup): ACTIVE; second call (loop i=0): DISCONNECTED
    vi.mocked(db.gmailConnection.findUnique)
      .mockResolvedValueOnce({
        gmailAddress: "test@gmail.com",
        googleSubjectId: "google-sub-1",
        encryptedRefreshToken: "enc-token",
        status: "ACTIVE",
      } as never)
      .mockResolvedValueOnce({ status: "DISCONNECTED" } as never);

    createBackfillInboxWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID }));

    const updateCalls = vi.mocked(db.providerSyncState.updateMany).mock.calls;

    // Should have stamped RUNNING at the start
    const runningCall = updateCalls.find(
      (c) => (c[0] as { data: { backfillStatus?: string } }).data?.backfillStatus === "RUNNING"
    );
    expect(runningCall).toBeDefined();

    // Should have reset to PENDING with null startedAt
    const pendingCall = updateCalls.find(
      (c) => (c[0] as { data: { backfillStatus?: string } }).data?.backfillStatus === "PENDING"
    );
    expect(pendingCall).toBeDefined();
    const pendingData = (pendingCall![0] as { data: { backfillStartedAt: unknown } }).data;
    expect(pendingData.backfillStartedAt).toBeNull();

    // Should NOT have reached DONE
    const doneCall = updateCalls.find(
      (c) => (c[0] as { data: { backfillStatus?: string } }).data?.backfillStatus === "DONE"
    );
    expect(doneCall).toBeUndefined();

    // Should NOT have enqueued any classify jobs
    expect(classifyThreadQueue.addBulk).not.toHaveBeenCalled();
  });
});
