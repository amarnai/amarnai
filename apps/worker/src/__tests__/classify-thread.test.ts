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
} = vi.hoisted(() => ({
  mockEmbed: vi.fn(),
  mockSortThreadByEmbedding: vi.fn(),
  mockAnalyzeThreadTriage: vi.fn(),
  mockClassifyTriageByEmbedding: vi.fn(),
  mockSnapshotToThreadMessages: vi.fn(),
  mockBuildThreadEmbeddingText: vi.fn(),
  mockGetThread: vi.fn(),
}));

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@amarnai/db", () => ({
  db: {
    emailThread: {
      findFirst: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
    gmailConnection: { findUnique: vi.fn() },
    taxonomyNode: { findMany: vi.fn() },
    taxonomyEdge: { findMany: vi.fn() },
    emailClassification: { create: vi.fn(), findFirst: vi.fn() },
  },
}));

vi.mock("@amarnai/ai", () => ({
  createAIProvider: vi.fn().mockReturnValue({ providerName: "mock", modelName: "mock" }),
  createEmbeddingProvider: vi.fn().mockReturnValue({ embed: mockEmbed }),
  sortThreadByEmbedding: mockSortThreadByEmbedding,
  analyzeThreadTriage: mockAnalyzeThreadTriage,
  classifyTriageByEmbedding: mockClassifyTriageByEmbedding,
  snapshotToThreadMessages: mockSnapshotToThreadMessages,
  buildThreadEmbeddingText: mockBuildThreadEmbeddingText,
  getRoutingAIProviderConfig: vi.fn().mockReturnValue({}),
  getEmbeddingProviderConfig: vi.fn().mockReturnValue({}),
}));

vi.mock("@amarnai/gmail", () => ({
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

// ─── Import after mocks ───────────────────────────────────────────────────────

import { db } from "@amarnai/db";
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
};

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  vi.mocked(db.emailThread.findFirst).mockResolvedValue({
    providerThreadId: "gmail-t1",
  } as never);
  vi.mocked(db.gmailConnection.findUnique).mockResolvedValue({
    encryptedRefreshToken: "enc-token",
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

  // Default: strong taxonomy (3 non-root nodes).
  vi.mocked(db.taxonomyNode.findMany).mockResolvedValue(makeNodes(3) as never);
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("createClassifyThreadWorker — UNROUTED early exit", () => {
  it("marks thread UNROUTED and skips embedding when non-root count < threshold", async () => {
    vi.mocked(db.taxonomyNode.findMany).mockResolvedValue(makeNodes(1) as never);

    createClassifyThreadWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID, emailThreadId: THREAD_ID }));

    expect(db.emailThread.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: THREAD_ID },
        data: expect.objectContaining({ triageStatus: "UNROUTED" }),
      })
    );
    expect(createEmbeddingProvider).not.toHaveBeenCalled();
    expect(mockSortThreadByEmbedding).not.toHaveBeenCalled();
  });

  it("marks thread UNROUTED when there are exactly 2 non-root nodes (one below threshold)", async () => {
    vi.mocked(db.taxonomyNode.findMany).mockResolvedValue(makeNodes(2) as never);

    createClassifyThreadWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID, emailThreadId: THREAD_ID }));

    expect(db.emailThread.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ triageStatus: "UNROUTED" }),
      })
    );
  });

  it("proceeds to classification when non-root count equals threshold (3)", async () => {
    vi.mocked(db.taxonomyNode.findMany).mockResolvedValue(makeNodes(3) as never);

    createClassifyThreadWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID, emailThreadId: THREAD_ID }));

    expect(mockSortThreadByEmbedding).toHaveBeenCalledOnce();
    // triageStatus must NOT be UNROUTED
    const updateCalls = vi.mocked(db.emailThread.update).mock.calls;
    const unroutedCall = updateCalls.find(
      (c) => (c[0] as { data: { triageStatus?: string } }).data?.triageStatus === "UNROUTED"
    );
    expect(unroutedCall).toBeUndefined();
  });

  it("marks thread UNROUTED when 3 non-root nodes exist but none are linked to the root", async () => {
    vi.mocked(db.taxonomyNode.findMany).mockResolvedValue(makeNodes(3) as never);
    // No edges → the three categories are orphaned, so none are routable.
    vi.mocked(db.taxonomyEdge.findMany).mockResolvedValue([] as never);

    createClassifyThreadWorker();
    const processor = getProcessor();
    await processor(makeJob({ workspaceId: WS_ID, emailThreadId: THREAD_ID }));

    expect(db.emailThread.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ triageStatus: "UNROUTED" }),
      })
    );
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
