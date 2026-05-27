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
    },
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

const mockListThreadsInWindow = vi.fn();
const mockGetThread = vi.fn();
const mockListThreadIdsByQuery = vi.fn().mockResolvedValue([]);

vi.mock("@amarnai/gmail", () => ({
  GmailClient: vi.fn().mockImplementation(() => ({
    listThreadsInWindow: mockListThreadsInWindow,
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
import { Worker } from "bullmq";
import { classifyThreadQueue } from "../queues.js";
import { createBackfillInboxWorker } from "../jobs/backfill-inbox.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const WS_ID = "ws-1";

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

  // Default workspace + connection stubs.
  vi.mocked(db.workspace.findUnique).mockResolvedValue({
    ownerUserId: "user-1",
  } as never);
  vi.mocked(db.gmailConnection.findUnique).mockResolvedValue({
    gmailAddress: "test@gmail.com",
    googleSubjectId: "google-sub-1",
    encryptedRefreshToken: "enc-token",
  } as never);
  // No settings row → defaults apply (includeSpam: false, includePromotions: false).
  vi.mocked(db.gmailSyncSettings.findUnique).mockResolvedValue(null);
  vi.mocked(db.emailAccount.findUnique).mockResolvedValue({
    id: "account-1",
  } as never);
  vi.mocked(db.providerSyncState.update).mockResolvedValue({} as never);
  vi.mocked(db.emailThread.upsert).mockResolvedValue({ id: "thread-db-1" } as never);
  vi.mocked(db.emailMessage.upsert).mockResolvedValue({} as never);
  mockGetThread.mockResolvedValue({ id: "gmail-1" });

  // Re-attach the mock on classifyThreadQueue.addBulk after clearAllMocks.
  vi.mocked(classifyThreadQueue.addBulk).mockResolvedValue([]);
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

    // Only findUnique should have been called — no update, no Gmail calls.
    expect(db.providerSyncState.update).not.toHaveBeenCalled();
    expect(mockListThreadsInWindow).not.toHaveBeenCalled();
    expect(classifyThreadQueue.addBulk).not.toHaveBeenCalled();
  });

  it("(a) returns early without any DB writes when backfillStatus is RUNNING", async () => {
    vi.mocked(db.providerSyncState.findUnique).mockResolvedValue({
      backfillStatus: "RUNNING",
    } as never);

    createBackfillInboxWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID }));

    expect(db.providerSyncState.update).not.toHaveBeenCalled();
    expect(mockListThreadsInWindow).not.toHaveBeenCalled();
  });

  it("(b) enqueues classify jobs with unread threads first, then by recency", async () => {
    vi.mocked(db.providerSyncState.findUnique).mockResolvedValue({
      backfillStatus: "PENDING",
    } as never);

    // Three threads: one read-old, one unread-mid, one read-new.
    // Expected order: unread-mid → read-new → read-old.
    const threads = [
      makeGmailThread({ id: "read-old", unread: false, daysAgo: 10 }),
      makeGmailThread({ id: "unread-mid", unread: true, daysAgo: 5 }),
      makeGmailThread({ id: "read-new", unread: false, daysAgo: 1 }),
    ];

    mockListThreadsInWindow.mockResolvedValue({ threads, totalFound: 3 });

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

  it("(c) backfillSkipped is correct when totalFound exceeds the cap", async () => {
    vi.mocked(db.providerSyncState.findUnique).mockResolvedValue({
      backfillStatus: "PENDING",
    } as never);

    // totalFound = 1200 but only 1000 threads returned (cap applied by listThreadsInWindow).
    const cappedThreads = Array.from({ length: 1000 }, (_, i) =>
      makeGmailThread({ id: `t-${i}`, unread: false, daysAgo: 1 })
    );
    mockListThreadsInWindow.mockResolvedValue({
      threads: cappedThreads,
      totalFound: 1200,
    });

    vi.mocked(db.emailThread.findUnique).mockResolvedValue(null);
    mockGetThread.mockImplementation(async (id: string) => ({ id }));
    vi.mocked(db.emailThread.upsert).mockImplementation(
      (({ create }: { create: { providerThreadId: string } }) =>
        Promise.resolve({ id: `db-${create.providerThreadId}` })) as never
    );

    createBackfillInboxWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID }));

    // The DONE update should record backfillSkipped = 1200 - 1000 = 200.
    const doneCalls = vi.mocked(db.providerSyncState.update).mock.calls.filter(
      (call) =>
        (call[0] as { data: { backfillStatus?: string } }).data?.backfillStatus === "DONE"
    );
    expect(doneCalls).toHaveLength(1);
    const doneData = (doneCalls[0]![0] as { data: { backfillSkipped: number } }).data;
    expect(doneData.backfillSkipped).toBe(200);
  });
});
