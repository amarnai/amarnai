import { vi, describe, it, expect, beforeEach } from "vitest";

// ─── Hoisted mocks (must precede vi.mock calls) ───────────────────────────────

const {
  mockEmbed,
  mockSortThreadByEmbedding,
  mockAnalyzeThreadTriage,
  mockClassifyTriageByEmbedding,
  mockSnapshotToThreadMessages,
  mockBuildThreadEmbeddingText,
  mockGetThread,
  mockGetMeterUsed,
  mockGetInboxPlanCeiling,
  mockRecordMeterUsage,
  mockNotifyThreadNeedsAttention,
} = vi.hoisted(() => ({
  mockEmbed: vi.fn(),
  mockSortThreadByEmbedding: vi.fn(),
  mockAnalyzeThreadTriage: vi.fn(),
  mockClassifyTriageByEmbedding: vi.fn(),
  mockSnapshotToThreadMessages: vi.fn(),
  mockBuildThreadEmbeddingText: vi.fn(),
  mockGetThread: vi.fn(),
  mockGetMeterUsed: vi.fn(),
  mockGetInboxPlanCeiling: vi.fn(),
  mockRecordMeterUsage: vi.fn(),
  mockNotifyThreadNeedsAttention: vi.fn(),
}));

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@amarnai/db", () => {
  const db = {
    workspace: { findUnique: vi.fn() },
    emailThread: {
      findFirst: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
    emailConnection: { findUnique: vi.fn() },
    gmailSyncSettings: { findUnique: vi.fn().mockResolvedValue(null) },
    taxonomyNode: { findMany: vi.fn() },
    taxonomyEdge: { findMany: vi.fn() },
    taxonomyNodeReference: { findMany: vi.fn() },
    emailClassification: { create: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
    // The classification row + meter increment now commit in one transaction; the
    // mock runs the callback with the same client so the create/meter mocks fire.
    $transaction: vi.fn((cb: (tx: unknown) => unknown) => cb(db)),
  };
  return {
    db,
    getInboxPlanCeiling: mockGetInboxPlanCeiling,
    inboxKeyFor: (a: string) => a,
    meterWindowStart: () => new Date("2026-06-01T00:00:00Z"),
    getMeterUsed: mockGetMeterUsed,
    recordMeterUsage: mockRecordMeterUsage,
    threadSortDedupToken: (inboxKey: string, windowStart: Date, id: string) =>
      `THREAD_SORT_${inboxKey}_${windowStart.toISOString()}_${id}`,
    markGmailConnectionAuthFailed: vi.fn().mockResolvedValue(false),
    maybeCreateQuotaBlockedNotifications: vi.fn().mockResolvedValue(undefined),
  };
});

// Quota enforcement is on by default; individual tests flip it as needed.
vi.mock("@amarnai/config", () => ({
  config: { billing: { enforceThreadSortQuota: true } },
}));

vi.mock("@amarnai/ai", () => ({
  createAIProvider: vi.fn().mockReturnValue({ providerName: "mock", modelName: "mock" }),
  createEmbeddingProvider: vi.fn().mockReturnValue({ embed: mockEmbed }),
  sortThreadByEmbedding: mockSortThreadByEmbedding,
  buildRoutingTelemetry: vi
    .fn()
    .mockReturnValue({ v: 1, maxRawSim: 0, maxSubtreeScore: 0, thetaMin: 0.13, topRawSims: [] }),
  THETA_MIN: 0.15,
  // Production routing config consumed by the worker (spread into the sort options
  // and read for the telemetry threshold). Mirror the real shape.
  CENTERED_ROUTING_CONFIG: {
    thetaMin: 0.13,
    lambdaDepthDecay: 1.0,
    softmaxTemperature: 0.05,
    thetaSpread: 0.1,
    thetaDescent: 0.0,
    crossBranchMargin: 0.05,
    scaleInvariant: true,
    meanCenter: true,
  },
  // Real classes so the worker's `err instanceof X` catch branches evaluate
  // instead of throwing on an undefined mock export (same pattern as the gmail mock).
  EmbeddingModelNotFoundError: class EmbeddingModelNotFoundError extends Error {},
  LLMAuthenticationError: class LLMAuthenticationError extends Error {},
  LLMRequestError: class LLMRequestError extends Error {},
  analyzeThreadTriage: mockAnalyzeThreadTriage,
  classifyTriageByEmbedding: mockClassifyTriageByEmbedding,
  snapshotToThreadMessages: mockSnapshotToThreadMessages,
  buildThreadEmbeddingText: mockBuildThreadEmbeddingText,
  hashEmbeddingInput: vi.fn().mockReturnValue("content-hash"),
  getRoutingAIProviderConfig: vi.fn().mockReturnValue({}),
  getEmbeddingProviderConfig: vi.fn().mockReturnValue({}),
}));

vi.mock("@amarnai/gmail", () => ({
  // Real classes so the worker's `err instanceof MailAuthError` catch branches
  // (MailAuthError etc. are these classes re-exported by @amarnai/mail) evaluate
  // instead of throwing on an undefined mock export.
  GmailAuthError: class GmailAuthError extends Error {},
  GmailHistoryCursorExpiredError: class GmailHistoryCursorExpiredError extends Error {},
  GmailThreadParseError: class GmailThreadParseError extends Error {},
  GmailThreadNotFoundError: class GmailThreadNotFoundError extends Error {},
  // The worker builds the client via createMailProvider (real), which constructs
  // this mocked GmailClient. getThreadSnapshot folds fetch + normalize: it awaits
  // the raw fetch (mockGetThread — so error tests still drive rejections) and
  // returns the normalized snapshot.
  GmailClient: vi.fn().mockImplementation(() => ({
    getThreadSnapshot: async (id: string) => {
      const r = (await mockGetThread(id)) as { id: string };
      return {
        providerThreadId: r.id,
        messages: [
          {
            providerMessageId: `msg-${r.id}`,
            senderEmail: "sender@example.com",
            receivedAt: new Date(),
          },
        ],
      };
    },
  })),
}));

vi.mock("bullmq", () => ({
  Worker: vi.fn().mockImplementation((_queue: string, processor: unknown) => ({
    _processor: processor,
    on: vi.fn(),
  })),
}));

vi.mock("../redis.js", () => ({ redisConnection: {} }));
vi.mock("../queues.js", () => ({
  QUEUE_CLASSIFY_THREAD: "classify-thread",
  pushNotificationQueue: { add: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock("../notifications/notify-threads.js", () => ({
  notifyThreadNeedsAttention: mockNotifyThreadNeedsAttention,
}));

// Retry-dedup is a pass-through here: every test drives the real embed mock.
// Dedup behavior itself is covered in ai-dedup.test.ts.
vi.mock("../ai-dedup.js", () => ({
  buildDedupKey: vi.fn().mockReturnValue("dedup-key"),
  buildEmbeddingCacheKey: vi.fn().mockReturnValue("embed-key"),
  memoizeAcrossRetries: vi.fn(
    (_key: string | null, codec: { compute: () => Promise<unknown> }) => codec.compute(),
  ),
  parseVector: vi.fn(),
  THREAD_EMBEDDING_TTL_SECONDS: 21600,
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import { db } from "@amarnai/db";
import { config } from "@amarnai/config";
import { Worker } from "bullmq";
import { createEmbeddingProvider } from "@amarnai/ai";
import { createClassifyThreadWorker } from "../jobs/classify-thread.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const WS_ID = "ws-1";
const THREAD_ID = "thread-1";
const ROOT_NODE_ID = "root-id";

function getProcessor(): (job: unknown) => Promise<void> {
  const WorkerMock = vi.mocked(Worker);
  const lastCall = WorkerMock.mock.calls[WorkerMock.mock.calls.length - 1];
  return lastCall?.[1] as (job: unknown) => Promise<void>;
}

function makeJob(data: Record<string, unknown>) {
  return { data, updateProgress: vi.fn(), attemptsMade: 0, opts: { attempts: 3 } };
}

function makeNodes(nonRootCount: number) {
  return [
    { id: ROOT_NODE_ID, isRoot: true, name: "Inbox", description: null, instructions: null, examples: [], embeddingVector: [], embeddingModel: null, embeddingTextHash: null },
    ...Array.from({ length: nonRootCount }, (_, i) => ({
      id: `node-${i + 1}`,
      isRoot: false,
      name: `Category ${i + 1}`,
      description: null,
      instructions: null,
      examples: [],
      embeddingVector: [],
      embeddingModel: null,
      embeddingTextHash: null,
    })),
  ];
}

// Edges linking each non-root node directly to the root, so the nodes are
// reachable (routable). Targets that do not match a node are harmless.
function makeEdges(nonRootCount: number) {
  return Array.from({ length: nonRootCount }, (_, i) => ({
    id: `edge-${i + 1}`,
    sourceNodeId: ROOT_NODE_ID,
    targetNodeId: `node-${i + 1}`,
  }));
}

const BASE_SORT_RESULT = {
  finalNodeId: "node-1",
  confidence: 0.85,
  explanation: "matched",
  needsHumanReview: false,
  decisionSource: "embedding",
  updatedNodeEmbeddings: [],
  failedOpenOnError: false,
};

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  // Quota enforcement on, FREE plan (limit 500), well under the cap by default.
  config.billing.enforceThreadSortQuota = true;
  vi.mocked(db.workspace.findUnique).mockResolvedValue({ plan: "FREE" } as never);
  mockGetInboxPlanCeiling.mockResolvedValue({ plan: "FREE", billingCycle: null });
  mockGetMeterUsed.mockResolvedValue(0);
  mockRecordMeterUsage.mockResolvedValue(undefined);
  // No prior metered classification for this thread this window by default.
  vi.mocked(db.emailClassification.count).mockResolvedValue(0 as never);

  vi.mocked(db.emailThread.findFirst).mockResolvedValue({
    providerThreadId: "gmail-t1",
  } as never);
  vi.mocked(db.emailConnection.findUnique).mockResolvedValue({
    provider: "GMAIL",
    encryptedRefreshToken: "enc-token",
    status: "ACTIVE",
    emailAddress: "ben@gmail.com",
  } as never);
  vi.mocked(db.emailThread.update).mockResolvedValue({} as never);
  vi.mocked(db.taxonomyEdge.findMany).mockResolvedValue(makeEdges(3) as never);
  vi.mocked(db.emailClassification.create).mockResolvedValue({ id: "cls-1" } as never);

  mockGetThread.mockResolvedValue({ id: "gmail-t1" });
  mockSnapshotToThreadMessages.mockReturnValue([{ subject: "Hi", bodyText: "body" }]);
  mockBuildThreadEmbeddingText.mockReturnValue("text");
  mockEmbed.mockResolvedValue([[0.1, 0.2, 0.3]]);
  mockSortThreadByEmbedding.mockResolvedValue(BASE_SORT_RESULT);
  mockAnalyzeThreadTriage.mockResolvedValue(null);
  mockClassifyTriageByEmbedding.mockResolvedValue(null);
  mockNotifyThreadNeedsAttention.mockResolvedValue(undefined);

  // Default: strong taxonomy (3 non-root nodes).
  vi.mocked(db.taxonomyNode.findMany).mockResolvedValue(makeNodes(3) as never);

  // Default: no manual-move pin and no reference threads.
  vi.mocked(db.emailClassification.findFirst).mockResolvedValue(null as never);
  vi.mocked(db.taxonomyNodeReference.findMany).mockResolvedValue([] as never);
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("createClassifyThreadWorker — weak taxonomy early exit", () => {
  it("skips embedding and leaves thread PENDING when non-root count < threshold", async () => {
    vi.mocked(db.taxonomyNode.findMany).mockResolvedValue(makeNodes(1) as never);

    createClassifyThreadWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID, emailThreadId: THREAD_ID }));

    const updateCalls = vi.mocked(db.emailThread.update).mock.calls;
    const unroutedCall = updateCalls.find(
      (c) => (c[0] as { data: { triageStatus?: string } }).data?.triageStatus === "UNROUTED"
    );
    expect(unroutedCall).toBeUndefined();
    expect(createEmbeddingProvider).not.toHaveBeenCalled();
    expect(mockSortThreadByEmbedding).not.toHaveBeenCalled();
  });

  it("skips embedding and leaves thread PENDING when exactly 2 non-root nodes (one below threshold)", async () => {
    vi.mocked(db.taxonomyNode.findMany).mockResolvedValue(makeNodes(2) as never);

    createClassifyThreadWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID, emailThreadId: THREAD_ID }));

    const updateCalls = vi.mocked(db.emailThread.update).mock.calls;
    const unroutedCall = updateCalls.find(
      (c) => (c[0] as { data: { triageStatus?: string } }).data?.triageStatus === "UNROUTED"
    );
    expect(unroutedCall).toBeUndefined();
  });

  it("proceeds to classification when non-root count equals threshold (3)", async () => {
    vi.mocked(db.taxonomyNode.findMany).mockResolvedValue(makeNodes(3) as never);

    createClassifyThreadWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID, emailThreadId: THREAD_ID }));

    expect(mockSortThreadByEmbedding).toHaveBeenCalledOnce();
    const updateCalls = vi.mocked(db.emailThread.update).mock.calls;
    const unroutedCall = updateCalls.find(
      (c) => (c[0] as { data: { triageStatus?: string } }).data?.triageStatus === "UNROUTED"
    );
    expect(unroutedCall).toBeUndefined();
  });

  it("skips embedding and leaves thread PENDING when 3 nodes exist but none are linked to root", async () => {
    vi.mocked(db.taxonomyNode.findMany).mockResolvedValue(makeNodes(3) as never);
    // No edges → the three categories are orphaned, so none are routable.
    vi.mocked(db.taxonomyEdge.findMany).mockResolvedValue([] as never);

    createClassifyThreadWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID, emailThreadId: THREAD_ID }));

    const updateCalls = vi.mocked(db.emailThread.update).mock.calls;
    const unroutedCall = updateCalls.find(
      (c) => (c[0] as { data: { triageStatus?: string } }).data?.triageStatus === "UNROUTED"
    );
    expect(unroutedCall).toBeUndefined();
    expect(createEmbeddingProvider).not.toHaveBeenCalled();
    expect(mockSortThreadByEmbedding).not.toHaveBeenCalled();
  });
});

describe("createClassifyThreadWorker — UNCLASSIFIED detection", () => {
  it("marks thread UNCLASSIFIED when finalNodeId is the root node", async () => {
    mockSortThreadByEmbedding.mockResolvedValue({
      ...BASE_SORT_RESULT,
      finalNodeId: ROOT_NODE_ID,
      needsHumanReview: false,
    });

    createClassifyThreadWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID, emailThreadId: THREAD_ID }));

    expect(db.emailThread.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ triageStatus: "UNCLASSIFIED" }),
      })
    );
  });

  it("still creates an EmailClassification record when thread is UNCLASSIFIED", async () => {
    mockSortThreadByEmbedding.mockResolvedValue({
      ...BASE_SORT_RESULT,
      finalNodeId: ROOT_NODE_ID,
    });

    createClassifyThreadWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID, emailThreadId: THREAD_ID }));

    expect(db.emailClassification.create).toHaveBeenCalledOnce();
  });

  it("marks thread SORTED when finalNodeId is a non-root node and needsHumanReview is false", async () => {
    mockSortThreadByEmbedding.mockResolvedValue({
      ...BASE_SORT_RESULT,
      finalNodeId: "node-1",
      needsHumanReview: false,
    });

    createClassifyThreadWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID, emailThreadId: THREAD_ID }));

    expect(db.emailThread.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ triageStatus: "SORTED" }),
      })
    );
  });

  it("marks thread NEEDS_REVIEW when finalNodeId is non-root and needsHumanReview is true", async () => {
    mockSortThreadByEmbedding.mockResolvedValue({
      ...BASE_SORT_RESULT,
      finalNodeId: "node-1",
      needsHumanReview: true,
    });

    createClassifyThreadWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID, emailThreadId: THREAD_ID }));

    expect(db.emailThread.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ triageStatus: "NEEDS_REVIEW" }),
      })
    );
  });
});

// ─── transientFailure persistence ──────────────────────────────────────────────

describe("createClassifyThreadWorker — transientFailure flag", () => {
  async function runWithSort(sort: Record<string, unknown>) {
    mockSortThreadByEmbedding.mockResolvedValue({ ...BASE_SORT_RESULT, ...sort });
    createClassifyThreadWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID, emailThreadId: THREAD_ID }));
    return vi.mocked(db.emailClassification.create).mock.calls[0]?.[0] as
      | { data: Record<string, unknown> }
      | undefined;
  }

  it("persists transientFailure:true on an LLM-error fail-open", async () => {
    const call = await runWithSort({
      finalNodeId: null,
      needsHumanReview: true,
      fallbackCause: "llm_error",
      failedOpenOnError: true,
    });
    expect(call?.data.transientFailure).toBe(true);
  });

  it("persists transientFailure:true on an embedding failure", async () => {
    const call = await runWithSort({
      finalNodeId: null,
      needsHumanReview: true,
      fallbackCause: "embedding_failed",
    });
    expect(call?.data.transientFailure).toBe(true);
  });

  it("persists transientFailure:false on a deliberate quality-gate fallback", async () => {
    const call = await runWithSort({
      finalNodeId: null,
      needsHumanReview: true,
      fallbackCause: "quality_gate",
    });
    expect(call?.data.transientFailure).toBe(false);
  });

  it("persists transientFailure:false on a successful placement (null cause)", async () => {
    const call = await runWithSort({ fallbackCause: null });
    expect(call?.data.transientFailure).toBe(false);
  });
});

// ─── Needs-attention push (fail-open suppression) ──────────────────────────────

describe("createClassifyThreadWorker — needs-attention push", () => {
  it("pushes when NEEDS_REVIEW comes from a real quality-gate decision", async () => {
    mockSortThreadByEmbedding.mockResolvedValue({
      ...BASE_SORT_RESULT,
      finalNodeId: "node-1",
      needsHumanReview: true,
      failedOpenOnError: false,
    });

    createClassifyThreadWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID, emailThreadId: THREAD_ID }));

    expect(mockNotifyThreadNeedsAttention).toHaveBeenCalledOnce();
  });

  it("does NOT push when NEEDS_REVIEW is an LLM-error fail-open", async () => {
    // inbox_fallback on LLM error: finalNodeId null → not the root, needsHumanReview
    // true → triageStatus NEEDS_REVIEW, but failedOpenOnError suppresses the push.
    mockSortThreadByEmbedding.mockResolvedValue({
      ...BASE_SORT_RESULT,
      finalNodeId: "node-1",
      needsHumanReview: true,
      decisionSource: "inbox_fallback",
      failedOpenOnError: true,
    });

    createClassifyThreadWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID, emailThreadId: THREAD_ID }));

    // Thread still flips to NEEDS_REVIEW (visible in-app) ...
    expect(db.emailThread.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ triageStatus: "NEEDS_REVIEW" }),
      })
    );
    // ... but the device push is suppressed to avoid an outage push-storm.
    expect(mockNotifyThreadNeedsAttention).not.toHaveBeenCalled();
  });
});

// ─── Disconnect-awareness ─────────────────────────────────────────────────────

describe("createClassifyThreadWorker — disconnect-awareness", () => {
  it("returns gracefully when connection status is not ACTIVE", async () => {
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue({
      encryptedRefreshToken: "enc-token",
      status: "DISCONNECTED",
    } as never);

    createClassifyThreadWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID, emailThreadId: THREAD_ID }));

    // Should not touch the thread or make any AI/Gmail calls
    expect(mockGetThread).not.toHaveBeenCalled();
    expect(mockSortThreadByEmbedding).not.toHaveBeenCalled();
    expect(db.emailThread.update).not.toHaveBeenCalled();
  });

  it("returns gracefully when connection is null", async () => {
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue(null);

    createClassifyThreadWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID, emailThreadId: THREAD_ID }));

    expect(mockGetThread).not.toHaveBeenCalled();
    expect(mockSortThreadByEmbedding).not.toHaveBeenCalled();
    expect(db.emailThread.update).not.toHaveBeenCalled();
  });
});

// ─── Monthly thread-sort quota ─────────────────────────────────────────────────

describe("createClassifyThreadWorker — monthly thread-sort quota", () => {
  it("defers the thread as QUOTA_BLOCKED and skips work when at the limit", async () => {
    // FREE limit is 500; pretend the inbox meter is already at 500 this month.
    mockGetMeterUsed.mockResolvedValue(500);

    createClassifyThreadWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID, emailThreadId: THREAD_ID, source: "LIVE" }));

    expect(db.emailThread.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: THREAD_ID },
        data: expect.objectContaining({ triageStatus: "QUOTA_BLOCKED" }),
      })
    );
    // No Gmail fetch, no embedding, no classification when blocked.
    expect(mockGetThread).not.toHaveBeenCalled();
    expect(mockSortThreadByEmbedding).not.toHaveBeenCalled();
    expect(db.emailClassification.create).not.toHaveBeenCalled();
  });

  it("does not block BACKFILL sorts and never counts toward the quota", async () => {
    mockGetMeterUsed.mockResolvedValue(10_000);

    createClassifyThreadWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID, emailThreadId: THREAD_ID, source: "BACKFILL" }));

    // Backfill is exempt: the meter is never consulted or recorded, and the thread sorts.
    expect(mockGetMeterUsed).not.toHaveBeenCalled();
    expect(mockRecordMeterUsage).not.toHaveBeenCalled();
    expect(mockSortThreadByEmbedding).toHaveBeenCalledOnce();
    expect(db.emailClassification.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ source: "BACKFILL" }) })
    );
  });

  it("stamps the job source onto the classification row", async () => {
    createClassifyThreadWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID, emailThreadId: THREAD_ID, source: "REROUTE" }));

    expect(db.emailClassification.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ source: "REROUTE" }) })
    );
  });

  it("defaults source to LIVE when the job omits it", async () => {
    createClassifyThreadWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID, emailThreadId: THREAD_ID }));

    expect(db.emailClassification.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ source: "LIVE" }) })
    );
  });

  it("never blocks (or re-counts) a re-sort of a thread already counted this window", async () => {
    // Inbox is AT the limit, but this thread was already metered this window
    // (a prior recurring classification exists), so the re-sort must still run.
    mockGetMeterUsed.mockResolvedValue(500);
    vi.mocked(db.emailClassification.count).mockResolvedValue(1 as never);

    createClassifyThreadWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID, emailThreadId: THREAD_ID, source: "LIVE" }));

    expect(db.emailThread.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ triageStatus: "QUOTA_BLOCKED" }) })
    );
    expect(mockSortThreadByEmbedding).toHaveBeenCalledOnce();
    // Already counted → not re-recorded.
    expect(mockRecordMeterUsage).not.toHaveBeenCalled();
  });

  it("skips the quota check entirely when enforcement is disabled (self-host)", async () => {
    config.billing.enforceThreadSortQuota = false;
    mockGetMeterUsed.mockResolvedValue(10_000);

    createClassifyThreadWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID, emailThreadId: THREAD_ID, source: "LIVE" }));

    // Gate is skipped (meter never read), but the sort still runs and is recorded
    // for observability.
    expect(mockGetMeterUsed).not.toHaveBeenCalled();
    expect(mockSortThreadByEmbedding).toHaveBeenCalledOnce();
    expect(mockRecordMeterUsage).toHaveBeenCalledOnce();
  });

  it("meters inside the same transaction as the classification row, keyed on a stable per-thread token", async () => {
    createClassifyThreadWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID, emailThreadId: THREAD_ID, source: "LIVE" }));

    // create + meter commit atomically (one transaction), and the meter carries a
    // deterministic dedup token (no timestamp) plus the transaction client.
    expect(db.$transaction).toHaveBeenCalled();
    expect(mockRecordMeterUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "THREAD_SORT",
        delta: 1,
        dedupToken: `THREAD_SORT_ben@gmail.com_2026-06-01T00:00:00.000Z_${THREAD_ID}`,
        tx: expect.anything(),
      }),
    );
  });

  it("a duplicated live job for the same thread produces the SAME dedup token (one meter unit)", async () => {
    // The dedup token is derived only from inbox + window + thread, so two concurrent
    // classify jobs for one thread present the identical token — the idempotent meter
    // (see usage-meter.test) then counts it exactly once.
    createClassifyThreadWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID, emailThreadId: THREAD_ID, source: "LIVE" }));
    await processor(makeJob({ workspaceId: WS_ID, emailThreadId: THREAD_ID, source: "LIVE" }));

    const tokens = mockRecordMeterUsage.mock.calls.map((c) => (c[0] as { dedupToken: string }).dedupToken);
    expect(tokens).toHaveLength(2);
    expect(new Set(tokens).size).toBe(1); // both jobs, one stable token
  });
});

// ─── Failure markers ────────────────────────────────────────────────────────

describe("createClassifyThreadWorker — failure markers", () => {
  function getFailedHandler(): (job: unknown, err: unknown) => void {
    const WorkerMock = vi.mocked(Worker);
    const lastResult = WorkerMock.mock.results[WorkerMock.mock.results.length - 1];
    const worker = lastResult?.value as { on: ReturnType<typeof vi.fn> };
    const failedCall = worker.on.mock.calls.find((c) => c[0] === "failed");
    return failedCall?.[1] as (job: unknown, err: unknown) => void;
  }

  it("stamps classifyFailedAt and increments classifyAttempts on permanent failure", async () => {
    createClassifyThreadWorker();
    const onFailed = getFailedHandler();
    expect(onFailed).toBeDefined();

    onFailed(
      { data: { workspaceId: WS_ID, emailThreadId: THREAD_ID }, attemptsMade: 3 },
      new Error("Premature close")
    );

    // markClassifyFailed is fire-and-forget; wait for the DB write.
    await vi.waitFor(() => expect(db.emailThread.update).toHaveBeenCalled());
    expect(db.emailThread.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: THREAD_ID },
        data: expect.objectContaining({
          classifyingAt: null,
          classifyFailedAt: expect.any(Date),
          classifyAttempts: { increment: 1 },
        }),
      })
    );
  });

  it("clears failure markers on a successful classify", async () => {
    mockSortThreadByEmbedding.mockResolvedValue({
      ...BASE_SORT_RESULT,
      finalNodeId: "node-1",
      needsHumanReview: false,
    });

    createClassifyThreadWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID, emailThreadId: THREAD_ID }));

    expect(db.emailThread.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ classifyFailedAt: null, classifyAttempts: 0 }),
      })
    );
  });
});


describe("createClassifyThreadWorker — manual-move pin", () => {
  function pinByMove() {
    vi.mocked(db.emailClassification.findFirst).mockResolvedValue({ source: "MOVE" } as never);
  }

  it("skips a LIVE re-sort when the latest classification is a manual MOVE", async () => {
    pinByMove();

    createClassifyThreadWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID, emailThreadId: THREAD_ID, source: "LIVE" }));

    expect(mockSortThreadByEmbedding).not.toHaveBeenCalled();
    expect(db.emailClassification.create).not.toHaveBeenCalled();
    // The skip must never flip the thread's triage status.
    const statusUpdate = vi.mocked(db.emailThread.update).mock.calls.find(
      (c) => (c[0] as { data: { triageStatus?: string } }).data?.triageStatus !== undefined
    );
    expect(statusUpdate).toBeUndefined();
  });

  it("skips BACKFILL and REROUTE re-sorts of a pinned thread", async () => {
    pinByMove();
    createClassifyThreadWorker();
    const processor = getProcessor();

    await processor(makeJob({ workspaceId: WS_ID, emailThreadId: THREAD_ID, source: "BACKFILL" }));
    await processor(makeJob({ workspaceId: WS_ID, emailThreadId: THREAD_ID, source: "REROUTE" }));

    expect(mockSortThreadByEmbedding).not.toHaveBeenCalled();
  });

  it("an explicit user-triggered sort (source MANUAL) bypasses the pin", async () => {
    pinByMove();

    createClassifyThreadWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID, emailThreadId: THREAD_ID, source: "MANUAL" }));

    expect(mockSortThreadByEmbedding).toHaveBeenCalledOnce();
  });

  it("does not pin when the latest classification is AI-made", async () => {
    vi.mocked(db.emailClassification.findFirst).mockResolvedValue({ source: "LIVE" } as never);

    createClassifyThreadWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID, emailThreadId: THREAD_ID, source: "LIVE" }));

    expect(mockSortThreadByEmbedding).toHaveBeenCalledOnce();
  });
});

describe("createClassifyThreadWorker — reference vectors for the sorter", () => {
  function lastSortOptions(): { referenceVectors?: Map<string, number[][]> } {
    const call = mockSortThreadByEmbedding.mock.calls.at(-1);
    return call?.[5] as { referenceVectors?: Map<string, number[][]> };
  }

  beforeEach(() => {
    // The reference-model filter compares against the provider's modelName.
    vi.mocked(createEmbeddingProvider).mockReturnValue({
      embed: mockEmbed,
      modelName: "mock-embed",
    } as never);
  });

  it("passes matching-model references, dropping stale-model rows and the thread's own row", async () => {
    vi.mocked(db.taxonomyNodeReference.findMany).mockResolvedValue([
      { nodeId: "node-1", emailThreadId: "other-1", embeddingVector: [1, 0], embeddingModel: "mock-embed" },
      // The thread's own reference would have self-similarity ≈ 1 and act as a
      // hidden pin — must be excluded.
      { nodeId: "node-1", emailThreadId: THREAD_ID, embeddingVector: [0, 1], embeddingModel: "mock-embed" },
      // Embedded under a previous model — incomparable, must be excluded.
      { nodeId: "node-2", emailThreadId: "other-2", embeddingVector: [1, 1], embeddingModel: "old-model" },
    ] as never);

    createClassifyThreadWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID, emailThreadId: THREAD_ID }));

    const { referenceVectors } = lastSortOptions();
    expect(referenceVectors).toBeInstanceOf(Map);
    expect(referenceVectors!.get("node-1")).toEqual([[1, 0]]);
    expect(referenceVectors!.has("node-2")).toBe(false);
  });

  it("caps the vectors per node at MAX_REFERENCES_PER_NODE, keeping the newest", async () => {
    // Rows arrive recency-ordered (updatedAt desc), so the first N survive.
    const rows = Array.from({ length: 14 }, (_, i) => ({
      nodeId: "node-1",
      emailThreadId: `other-${i}`,
      embeddingVector: [i, 0],
      embeddingModel: "mock-embed",
    }));
    vi.mocked(db.taxonomyNodeReference.findMany).mockResolvedValue(rows as never);

    createClassifyThreadWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID, emailThreadId: THREAD_ID }));

    const { referenceVectors } = lastSortOptions();
    const vectors = referenceVectors!.get("node-1")!;
    expect(vectors).toHaveLength(10);
    expect(vectors[0]).toEqual([0, 0]);
    expect(vectors[9]).toEqual([9, 0]);
  });

  it("passes an empty map when the workspace has no references", async () => {
    createClassifyThreadWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID, emailThreadId: THREAD_ID }));

    const { referenceVectors } = lastSortOptions();
    expect(referenceVectors).toBeInstanceOf(Map);
    expect(referenceVectors!.size).toBe(0);
  });
});
