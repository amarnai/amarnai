import { vi, describe, it, expect, beforeEach } from "vitest";

// ─── Hoisted mocks (must precede vi.mock calls) ───────────────────────────────

const { mockEmbed, mockBuildThreadEmbeddingText, mockHashEmbeddingInput } = vi.hoisted(() => ({
  mockEmbed: vi.fn(),
  mockBuildThreadEmbeddingText: vi.fn(),
  mockHashEmbeddingInput: vi.fn(),
}));

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@aziru/db", () => ({
  db: {
    taxonomyNodeReference: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    emailMessage: { findMany: vi.fn() },
  },
}));

vi.mock("@aziru/ai", () => ({
  createEmbeddingProvider: vi.fn().mockReturnValue({ embed: mockEmbed, modelName: "mock-embed" }),
  getEmbeddingProviderConfig: vi.fn().mockReturnValue({}),
  buildThreadEmbeddingText: mockBuildThreadEmbeddingText,
  hashEmbeddingInput: mockHashEmbeddingInput,
}));

vi.mock("bullmq", () => ({
  Worker: vi.fn().mockImplementation((_queue: string, processor: unknown) => ({
    _processor: processor,
    on: vi.fn(),
  })),
}));

vi.mock("../redis.js", () => ({ redisConnection: {} }));
vi.mock("../queues.js", () => ({
  QUEUE_CAPTURE_REFERENCE: "capture-reference",
}));

// Pass-through memoization: every test drives the real embed mock. Dedup
// behavior itself is covered in ai-dedup.test.ts.
vi.mock("../ai-dedup.js", () => ({
  buildEmbeddingCacheKey: vi.fn().mockReturnValue("embed-key"),
  memoizeAcrossRetries: vi.fn(
    (_key: string | null, codec: { compute: () => Promise<unknown> }) => codec.compute(),
  ),
  parseVector: vi.fn(),
  THREAD_EMBEDDING_TTL_SECONDS: 21600,
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import { db } from "@aziru/db";
import { Worker } from "bullmq";
import { createCaptureReferenceWorker } from "../jobs/capture-reference.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const WS_ID = "ws-1";
const THREAD_ID = "thread-1";
const REF_ID = "ref-1";
const NODE_ID = "node-1";

function getProcessor(): (job: unknown) => Promise<void> {
  const WorkerMock = vi.mocked(Worker);
  const lastCall = WorkerMock.mock.calls[WorkerMock.mock.calls.length - 1];
  return lastCall?.[1] as (job: unknown) => Promise<void>;
}

function run() {
  createCaptureReferenceWorker();
  return getProcessor()({ data: { workspaceId: WS_ID, emailThreadId: THREAD_ID } });
}

beforeEach(() => {
  vi.clearAllMocks();

  vi.mocked(db.taxonomyNodeReference.findFirst).mockResolvedValue({
    id: REF_ID,
    nodeId: NODE_ID,
    embeddingModel: null,
    embeddingTextHash: null,
  } as never);
  vi.mocked(db.emailMessage.findMany).mockResolvedValue([
    { subject: "Invoice", bodyText: "Please find attached", attachments: [{ filename: "inv.pdf", mimeType: "application/pdf" }] },
  ] as never);
  vi.mocked(db.taxonomyNodeReference.updateMany).mockResolvedValue({ count: 1 } as never);
  vi.mocked(db.taxonomyNodeReference.deleteMany).mockResolvedValue({ count: 0 } as never);
  // Prune query: only this row exists for the node.
  vi.mocked(db.taxonomyNodeReference.findMany).mockResolvedValue([{ id: REF_ID }] as never);

  mockBuildThreadEmbeddingText.mockReturnValue("thread text");
  mockHashEmbeddingInput.mockReturnValue("hash-1");
  mockEmbed.mockResolvedValue([[0.1, 0.2, 0.3]]);
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("createCaptureReferenceWorker", () => {
  it("embeds the persisted thread content and fills the reference row", async () => {
    await run();

    // Attachment filenames are included, mirroring classify-thread's message
    // slice so the content-addressed embedding cache key matches.
    expect(mockBuildThreadEmbeddingText).toHaveBeenCalledWith([
      { subject: "Invoice", bodyText: "Please find attached", attachmentNames: ["inv.pdf"] },
    ]);
    expect(mockEmbed).toHaveBeenCalledWith(["thread text"]);
    expect(db.taxonomyNodeReference.updateMany).toHaveBeenCalledWith({
      where: { id: REF_ID },
      data: {
        embeddingVector: [0.1, 0.2, 0.3],
        embeddingModel: "mock-embed",
        embeddingTextHash: "hash-1",
      },
    });
  });

  it("no-ops when the reference row is gone (undo retracted it)", async () => {
    vi.mocked(db.taxonomyNodeReference.findFirst).mockResolvedValue(null as never);

    await run();

    expect(mockEmbed).not.toHaveBeenCalled();
    expect(db.taxonomyNodeReference.updateMany).not.toHaveBeenCalled();
  });

  it("no-ops when the stored hash and model are already current (retry / duplicate enqueue)", async () => {
    vi.mocked(db.taxonomyNodeReference.findFirst).mockResolvedValue({
      id: REF_ID,
      nodeId: NODE_ID,
      embeddingModel: "mock-embed",
      embeddingTextHash: "hash-1",
    } as never);

    await run();

    expect(mockEmbed).not.toHaveBeenCalled();
    expect(db.taxonomyNodeReference.updateMany).not.toHaveBeenCalled();
  });

  it("re-embeds when the row was captured under a different model", async () => {
    vi.mocked(db.taxonomyNodeReference.findFirst).mockResolvedValue({
      id: REF_ID,
      nodeId: NODE_ID,
      embeddingModel: "old-model",
      embeddingTextHash: "hash-1",
    } as never);

    await run();

    expect(mockEmbed).toHaveBeenCalledOnce();
    expect(db.taxonomyNodeReference.updateMany).toHaveBeenCalled();
  });

  it("deletes the row instead of embedding when the thread has no text content", async () => {
    mockBuildThreadEmbeddingText.mockReturnValue("   ");

    await run();

    expect(mockEmbed).not.toHaveBeenCalled();
    expect(db.taxonomyNodeReference.deleteMany).toHaveBeenCalledWith({ where: { id: REF_ID } });
    expect(db.taxonomyNodeReference.updateMany).not.toHaveBeenCalled();
  });

  it("throws on a failed embed so BullMQ retries", async () => {
    mockEmbed.mockResolvedValue([[]]);

    await expect(run()).rejects.toThrow(/Embedding failed/);
    expect(db.taxonomyNodeReference.updateMany).not.toHaveBeenCalled();
  });

  it("prunes the node's references beyond the retention cap, keeping the newest", async () => {
    const keep = Array.from({ length: 10 }, (_, i) => ({ id: `keep-${i}` }));
    vi.mocked(db.taxonomyNodeReference.findMany).mockResolvedValue(keep as never);

    await run();

    expect(db.taxonomyNodeReference.findMany).toHaveBeenCalledWith({
      where: { workspaceId: WS_ID, nodeId: NODE_ID },
      orderBy: { updatedAt: "desc" },
      take: 10,
      select: { id: true },
    });
    expect(db.taxonomyNodeReference.deleteMany).toHaveBeenCalledWith({
      where: {
        workspaceId: WS_ID,
        nodeId: NODE_ID,
        id: { notIn: keep.map((r) => r.id) },
      },
    });
  });
});
