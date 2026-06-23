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
  mockCountRecurringThreadSorts,
  mockNotifyThreadNeedsAttention,
} = vi.hoisted(() => ({
  mockEmbed: vi.fn(),
  mockSortThreadByEmbedding: vi.fn(),
  mockAnalyzeThreadTriage: vi.fn(),
  mockClassifyTriageByEmbedding: vi.fn(),
  mockSnapshotToThreadMessages: vi.fn(),
  mockBuildThreadEmbeddingText: vi.fn(),
  mockGetThread: vi.fn(),
  mockCountRecurringThreadSorts: vi.fn(),
  mockNotifyThreadNeedsAttention: vi.fn(),
}));

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@amarnai/db", () => ({
  db: {
    workspace: { findUnique: vi.fn() },
    emailThread: {
      findFirst: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
    gmailConnection: { findUnique: vi.fn() },
    taxonomyNode: { findMany: vi.fn() },
    taxonomyEdge: { findMany: vi.fn() },
    emailClassification: { create: vi.fn(), findFirst: vi.fn() },
  },
  countRecurringThreadSorts: mockCountRecurringThreadSorts,
}));

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
    .mockReturnValue({ v: 1, maxRawSim: 0, maxSubtreeScore: 0, thetaMin: 0.15, topRawSims: [] }),
  THETA_MIN: 0.15,
  analyzeThreadTriage: mockAnalyzeThreadTriage,
  classifyTriageByEmbedding: mockClassifyTriageByEmbedding,
  snapshotToThreadMessages: mockSnapshotToThreadMessages,
  buildThreadEmbeddingText: mockBuildThreadEmbeddingText,
  hashEmbeddingInput: vi.fn().mockReturnValue("content-hash"),
  getRoutingAIProviderConfig: vi.fn().mockReturnValue({}),
  getEmbeddingProviderConfig: vi.fn().mockReturnValue({}),
}));

vi.mock("@amarnai/gmail", () => ({
  // Real class so `err instanceof GmailAuthError` in the worker's catch block
  // evaluates instead of throwing on an undefined mock export.
  GmailAuthError: class GmailAuthError extends Error {},
  GmailClient: vi.fn().mockImplementation(() => ({
    getThread: mockGetThread,
  })),
  normalizeGmailThread: vi.fn().mockImplementation((raw: unknown) => {
    const r = raw as { id: string };
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
  }),
}));

vi.mock("bullmq", () => ({
  Worker: vi.fn().mockImplementation((_queue: string, processor: unknown) => ({
    _processor: processor,
    on: vi.fn(),
  })),
}));

vi.mock("../redis.js", () => ({ redisConnection: {} }));
vi.mock("../queues.js", () => ({ QUEUE_CLASSIFY_THREAD: "classify-thread" }));

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
  mockCountRecurringThreadSorts.mockResolvedValue(0);

  vi.mocked(db.emailThread.findFirst).mockResolvedValue({
    providerThreadId: "gmail-t1",
  } as never);
  vi.mocked(db.gmailConnection.findUnique).mockResolvedValue({
    encryptedRefreshToken: "enc-token",
    status: "ACTIVE",
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
    vi.mocked(db.gmailConnection.findUnique).mockResolvedValue({
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
    vi.mocked(db.gmailConnection.findUnique).mockResolvedValue(null);

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
    // FREE limit is 500; pretend 500 recurring threads already sorted this month.
    mockCountRecurringThreadSorts.mockResolvedValue(500);

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
    mockCountRecurringThreadSorts.mockResolvedValue(10_000);

    createClassifyThreadWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID, emailThreadId: THREAD_ID, source: "BACKFILL" }));

    // Backfill is exempt: the count is never consulted and the thread is sorted.
    expect(mockCountRecurringThreadSorts).not.toHaveBeenCalled();
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

  it("excludes the current thread from the count so re-sorts are not blocked", async () => {
    mockCountRecurringThreadSorts.mockResolvedValue(0);

    createClassifyThreadWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID, emailThreadId: THREAD_ID, source: "LIVE" }));

    // The count helper must be asked to exclude this thread.
    expect(mockCountRecurringThreadSorts).toHaveBeenCalledWith(
      WS_ID,
      expect.any(Date),
      THREAD_ID
    );
    expect(mockSortThreadByEmbedding).toHaveBeenCalledOnce();
  });

  it("skips the quota check entirely when enforcement is disabled (self-host)", async () => {
    config.billing.enforceThreadSortQuota = false;
    mockCountRecurringThreadSorts.mockResolvedValue(10_000);

    createClassifyThreadWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID, emailThreadId: THREAD_ID, source: "LIVE" }));

    expect(mockCountRecurringThreadSorts).not.toHaveBeenCalled();
    expect(mockSortThreadByEmbedding).toHaveBeenCalledOnce();
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

