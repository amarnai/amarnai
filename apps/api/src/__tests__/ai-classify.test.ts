import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

vi.mock("@amarnai/db", () => ({
  Prisma: {},
  db: {
    emailThread: { findFirst: vi.fn() },
    taxonomyNode: { findMany: vi.fn(), update: vi.fn() },
    taxonomyEdge: { findMany: vi.fn() },
    emailClassification: { create: vi.fn() },
    reviewItem: { create: vi.fn() },
  },
}));

const mockCreateAIProvider = vi.fn().mockReturnValue({
  providerName: "test-provider",
  modelName: "test-model",
});
const mockCreateEmbeddingProvider = vi.fn().mockReturnValue({
  providerName: "test-embedding",
  modelName: "test-embedding-model",
  embed: vi.fn(),
});
const mockSortThreadByEmbedding = vi.fn();
vi.mock("@amarnai/ai", () => ({
  createAIProvider: (...args: unknown[]) => mockCreateAIProvider(...args),
  createEmbeddingProvider: (...args: unknown[]) => mockCreateEmbeddingProvider(...args),
  sortThreadByEmbedding: (...args: unknown[]) => mockSortThreadByEmbedding(...args),
}));

import app from "../app.js";
import { db } from "@amarnai/db";

const WS_ID = "ws-1";
const THREAD_ID = "thread-1";
const CLS_ID = "cls-1";
const REVIEW_ID = "review-1";

const NODES = [
  {
    id: "node-root",
    name: "Inbox",
    description: null,
    instructions: null,
    examples: [],
    isRoot: true,
    embeddingVector: [],
    embeddingModel: null,
    embeddingTextHash: null,
  },
  {
    id: "node-leaf",
    name: "Clients",
    description: "Client emails",
    instructions: null,
    examples: [],
    isRoot: false,
    embeddingVector: [],
    embeddingModel: null,
    embeddingTextHash: null,
  },
];

const EDGES = [
  {
    id: "edge-1",
    sourceNodeId: "node-root",
    targetNodeId: "node-leaf",
  },
];

const THREAD = {
  id: THREAD_ID,
  messages: [
    {
      subject: "Hello",
      senderEmail: "client@example.com",
      senderName: "Client",
      bodyText: "Can we talk?",
      receivedAt: new Date(),
    },
  ],
};

const VALID_AI_RESULT = {
  finalNodeId: "node-leaf",
  path: [],
  confidence: 0.9,
  explanation: "Client email",
  needsHumanReview: false,
  decisionSource: "embedding_auto" as const,
  rawSimilarities: {},
  subtreeScores: {},
  updatedNodeEmbeddings: [],
};

const REVIEW_NEEDED_RESULT = {
  ...VALID_AI_RESULT,
  finalNodeId: null,
  confidence: 0,
  explanation: "No branch matched confidently",
  needsHumanReview: true,
  decisionSource: "inbox_fallback" as const,
};

function post(path: string) {
  return app.request(path, { method: "POST" });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env["AI_PROVIDER"] = "ollama";
  process.env["OLLAMA_BASE_URL"] = "http://localhost:11434";
  process.env["OLLAMA_MODEL"] = "llama3.1:8b";
  vi.mocked(db.reviewItem.create).mockResolvedValue({ id: REVIEW_ID } as never);
  vi.mocked(db.emailClassification.create).mockResolvedValue({ id: CLS_ID } as never);
  vi.mocked(db.taxonomyNode.findMany).mockResolvedValue(NODES as never);
  vi.mocked(db.taxonomyEdge.findMany).mockResolvedValue(EDGES as never);
  vi.mocked(db.emailThread.findFirst).mockResolvedValue(THREAD as never);
});

afterEach(() => {
  delete process.env["AI_PROVIDER"];
  delete process.env["OLLAMA_BASE_URL"];
  delete process.env["OLLAMA_MODEL"];
});

// ─── ai-classify ──────────────────────────────────────────────────────────────

describe("POST /workspaces/:workspaceId/email-threads/:threadId/ai-classify", () => {
  it("returns 400 when AI provider throws during setup", async () => {
    mockCreateAIProvider.mockImplementationOnce(() => {
      throw new Error("AI_PROVIDER is set to 'mock'. Set AI_PROVIDER=ollama or AI_PROVIDER=frontier to use AI classification.");
    });
    const res = await post(`/workspaces/${WS_ID}/email-threads/${THREAD_ID}/ai-classify`);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/mock/);
  });

  it("returns 404 when thread not found", async () => {
    vi.mocked(db.emailThread.findFirst).mockResolvedValue(null);
    const res = await post(`/workspaces/${WS_ID}/email-threads/${THREAD_ID}/ai-classify`);
    expect(res.status).toBe(404);
  });

  it("returns 422 when no taxonomy nodes exist", async () => {
    vi.mocked(db.taxonomyNode.findMany).mockResolvedValue([] as never);
    const res = await post(`/workspaces/${WS_ID}/email-threads/${THREAD_ID}/ai-classify`);
    expect(res.status).toBe(422);
  });

  it("persists classification and returns 201 on valid result", async () => {
    mockSortThreadByEmbedding.mockResolvedValue(VALID_AI_RESULT);

    const res = await post(`/workspaces/${WS_ID}/email-threads/${THREAD_ID}/ai-classify`);

    expect(res.status).toBe(201);
    const body = await res.json() as Record<string, unknown>;
    expect((body.classification as Record<string, unknown>).id).toBe(CLS_ID);
    expect(db.emailClassification.create).toHaveBeenCalledTimes(1);
    expect(db.reviewItem.create).not.toHaveBeenCalled();
  });

  it("creates review item when needsHumanReview is true", async () => {
    mockSortThreadByEmbedding.mockResolvedValue(REVIEW_NEEDED_RESULT);

    const res = await post(`/workspaces/${WS_ID}/email-threads/${THREAD_ID}/ai-classify`);

    expect(res.status).toBe(201);
    const body = await res.json() as Record<string, unknown>;
    expect(body.reviewItemCreated).toBe(true);
    expect(body.reviewItemId).toBe(REVIEW_ID);
    expect(db.reviewItem.create).toHaveBeenCalledTimes(1);
  });

  it("persists review-needed classification when finalNodeId is null", async () => {
    mockSortThreadByEmbedding.mockResolvedValue(REVIEW_NEEDED_RESULT);

    await post(`/workspaces/${WS_ID}/email-threads/${THREAD_ID}/ai-classify`);

    expect(db.emailClassification.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ finalNodeId: null, needsHumanReview: true }) })
    );
  });

  it("creates a new classification row on each call (history accumulates)", async () => {
    mockSortThreadByEmbedding.mockResolvedValue(VALID_AI_RESULT);

    vi.mocked(db.emailClassification.create)
      .mockResolvedValueOnce({ id: "cls-1" } as never)
      .mockResolvedValueOnce({ id: "cls-2" } as never);

    const res1 = await post(`/workspaces/${WS_ID}/email-threads/${THREAD_ID}/ai-classify`);
    const res2 = await post(`/workspaces/${WS_ID}/email-threads/${THREAD_ID}/ai-classify`);

    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);
    expect(db.emailClassification.create).toHaveBeenCalledTimes(2);

    const b1 = await res1.json() as Record<string, unknown>;
    const b2 = await res2.json() as Record<string, unknown>;
    expect((b1.classification as Record<string, unknown>).id).toBe("cls-1");
    expect((b2.classification as Record<string, unknown>).id).toBe("cls-2");
  });
});

// ─── mock-classify ────────────────────────────────────────────────────────────

describe("POST /workspaces/:workspaceId/email-threads/:threadId/mock-classify", () => {
  it("returns 201 with classification result", async () => {
    const res = await post(
      `/workspaces/${WS_ID}/email-threads/${THREAD_ID}/mock-classify`
    );
    expect(res.status).toBe(201);
    expect(db.emailClassification.create).toHaveBeenCalledTimes(1);
  });

  it("returns 404 when thread not found", async () => {
    vi.mocked(db.emailThread.findFirst).mockResolvedValue(null);
    const res = await post(
      `/workspaces/${WS_ID}/email-threads/${THREAD_ID}/mock-classify`
    );
    expect(res.status).toBe(404);
  });
});
