import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { authed } from "./helpers.js";

vi.mock("@amarnai/db", () => ({
  Prisma: {},
  db: {
    workspace: { findUnique: vi.fn() },
    emailThread: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    emailMessage: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    emailClassification: { create: vi.fn() },
    taxonomyEdge: { findMany: vi.fn() },
    taxonomyNode: { update: vi.fn() },
  },
}));

const mockSortThreadByEmbedding = vi.fn();
vi.mock("@amarnai/ai", () => ({
  createAIProvider: vi.fn().mockReturnValue({
    providerName: "test-provider",
    modelName: "test-model",
  }),
  createEmbeddingProvider: vi.fn().mockReturnValue({
    providerName: "test-embedding",
    modelName: "test-embedding-model",
    embed: vi.fn(),
  }),
  sortThreadByEmbedding: (...args: unknown[]) => mockSortThreadByEmbedding(...args),
  selectCandidateNodes: vi.fn().mockReturnValue({ candidates: [], diagnostics: { queryText: "", matchedProfiles: [], warnings: [] } }),
  buildCandidateNodePrompt: vi.fn().mockReturnValue([]),
  validateNodeSelection: vi.fn().mockReturnValue({ finalNodeId: null, confidence: 0, explanation: "mock", needsHumanReview: true }),
}));

import app from "../app.js";
import { db } from "@amarnai/db";

const WS_ID = "ws-1";
const THREAD_ID = "thread-1";
const MSG_ID = "msg-1";
const CLS_ID = "cls-1";

const ACCOUNT_ID = "account-1";
const NODE_ROOT = {
  id: "node-root",
  name: "Inbox",
  description: null,
  instructions: null,
  examples: [],
  isRoot: true,
  embeddingVector: [],
  embeddingModel: null,
  embeddingTextHash: null,
};
const NODE_LEAF = {
  id: "node-leaf",
  name: "Clients",
  description: "Client emails",
  instructions: null,
  examples: [],
  isRoot: false,
  embeddingVector: [],
  embeddingModel: null,
  embeddingTextHash: null,
};

const mockWorkspace = {
  id: WS_ID,
  emailAccounts: [{ id: ACCOUNT_ID }],
  taxonomyNodes: [NODE_ROOT, NODE_LEAF],
};

const mockThread = {
  id: THREAD_ID,
  subject: "Test Thread",
  messageCount: 1,
  latestMessageAt: new Date().toISOString(),
  emailAccountId: ACCOUNT_ID,
};

const mockMessages = [
  { subject: "Hello", senderEmail: "test@example.com", senderName: "Test", bodyText: "Hello world", receivedAt: new Date() },
];

function post(path: string, body: unknown) {
  return app.request(path, authed({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env["ENABLE_DEV_TOOLS"] = "true";
  vi.mocked(db.taxonomyEdge.findMany).mockResolvedValue([] as never);
});

afterEach(() => {
  delete process.env["ENABLE_DEV_TOOLS"];
});

// ─── Dev guard ────────────────────────────────────────────────────────────────

describe("dev guard", () => {
  it("returns 404 when ENABLE_DEV_TOOLS is not set and NODE_ENV is not development", async () => {
    delete process.env["ENABLE_DEV_TOOLS"];
    // NODE_ENV is "test" in vitest, so neither condition passes

    const res = await post(`/dev/workspaces/${WS_ID}/mock-inbox-event`, {
      mode: "new_thread",
      senderEmail: "test@example.com",
      bodyText: "Hello world",
    });

    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("Not found");
  });

  it("returns 201 when ENABLE_DEV_TOOLS is set", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue(mockWorkspace as never);
    vi.mocked(db.emailThread.create).mockResolvedValue({ id: THREAD_ID } as never);
    vi.mocked(db.emailMessage.create).mockResolvedValue({ id: MSG_ID } as never);
    // "clients" matches NODE_LEAF name → confidence 0.76 → no review item
    vi.mocked(db.emailMessage.findMany).mockResolvedValue([
      { subject: null, senderEmail: "test@example.com", senderName: null, bodyText: "Clients meeting", receivedAt: new Date() },
    ] as never);
    vi.mocked(db.emailThread.findUniqueOrThrow).mockResolvedValue(mockThread as never);
    vi.mocked(db.emailClassification.create).mockResolvedValue({ id: CLS_ID } as never);

    const res = await post(`/dev/workspaces/${WS_ID}/mock-inbox-event`, {
      mode: "new_thread",
      senderEmail: "test@example.com",
      bodyText: "Clients meeting",
    });

    expect(res.status).toBe(201);
  });
});

// ─── New thread mode ──────────────────────────────────────────────────────────

describe("new thread mode", () => {
  it("creates thread + message + classification", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue(mockWorkspace as never);
    vi.mocked(db.emailThread.create).mockResolvedValue({ id: THREAD_ID } as never);
    vi.mocked(db.emailMessage.create).mockResolvedValue({ id: MSG_ID } as never);
    // "clients" matches NODE_LEAF name → confidence 0.76 → needsHumanReview = false
    vi.mocked(db.emailMessage.findMany).mockResolvedValue([
      { subject: "Clients kickoff", senderEmail: "alice@example.com", senderName: "Alice", bodyText: "Clients project kickoff.", receivedAt: new Date() },
    ] as never);
    vi.mocked(db.emailThread.findUniqueOrThrow).mockResolvedValue(mockThread as never);
    vi.mocked(db.emailClassification.create).mockResolvedValue({ id: CLS_ID } as never);

    const res = await post(`/dev/workspaces/${WS_ID}/mock-inbox-event`, {
      mode: "new_thread",
      subject: "Clients kickoff",
      senderName: "Alice Smith",
      senderEmail: "alice@example.com",
      bodyText: "Clients project kickoff.",
    });

    expect(res.status).toBe(201);
    const body = await res.json() as Record<string, unknown>;
    expect(body.thread).toMatchObject({ id: THREAD_ID, isNew: true });
    expect(body.classification).toMatchObject({ id: CLS_ID });
    expect(db.emailThread.create).toHaveBeenCalledTimes(1);
    expect(db.emailMessage.create).toHaveBeenCalledTimes(1);
    expect(db.emailClassification.create).toHaveBeenCalledTimes(1);
  });

  it("sets triageStatus to NEEDS_REVIEW when confidence is low (no keyword matches)", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue(mockWorkspace as never);
    vi.mocked(db.emailThread.create).mockResolvedValue({ id: THREAD_ID } as never);
    vi.mocked(db.emailMessage.create).mockResolvedValue({ id: MSG_ID } as never);
    // No keyword matches → confidence 0.35 → needsHumanReview = true
    vi.mocked(db.emailMessage.findMany).mockResolvedValue([
      { subject: null, senderEmail: "x@y.com", senderName: null, bodyText: "zzz", receivedAt: new Date() },
    ] as never);
    vi.mocked(db.emailThread.findUniqueOrThrow).mockResolvedValue(mockThread as never);
    vi.mocked(db.emailClassification.create).mockResolvedValue({ id: CLS_ID } as never);

    const res = await post(`/dev/workspaces/${WS_ID}/mock-inbox-event`, {
      mode: "new_thread",
      senderEmail: "x@y.com",
      bodyText: "zzz",
    });

    expect(res.status).toBe(201);
    expect(db.emailThread.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ triageStatus: "NEEDS_REVIEW" }) })
    );
  });

  it("returns 404 when workspace not found", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue(null);

    const res = await post(`/dev/workspaces/${WS_ID}/mock-inbox-event`, {
      mode: "new_thread",
      senderEmail: "test@example.com",
      bodyText: "Hello",
    });

    expect(res.status).toBe(404);
  });

  it("returns 400 on missing senderEmail", async () => {
    const res = await post(`/dev/workspaces/${WS_ID}/mock-inbox-event`, {
      mode: "new_thread",
      bodyText: "Hello",
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("Validation error");
  });

  it("returns 400 on missing bodyText", async () => {
    const res = await post(`/dev/workspaces/${WS_ID}/mock-inbox-event`, {
      mode: "new_thread",
      senderEmail: "test@example.com",
    });

    expect(res.status).toBe(400);
  });
});

// ─── Existing thread mode ─────────────────────────────────────────────────────

describe("existing thread mode", () => {
  it("appends message, updates thread, and creates new classification", async () => {
    const updatedThread = { ...mockThread, messageCount: 2 };
    vi.mocked(db.workspace.findUnique).mockResolvedValue(mockWorkspace as never);
    vi.mocked(db.emailThread.findFirst).mockResolvedValue(
      { id: THREAD_ID, emailAccountId: ACCOUNT_ID } as never
    );
    vi.mocked(db.emailMessage.create).mockResolvedValue({ id: MSG_ID } as never);
    vi.mocked(db.emailThread.update).mockResolvedValue(updatedThread as never);
    vi.mocked(db.emailMessage.findMany).mockResolvedValue(mockMessages as never);
    vi.mocked(db.emailThread.findUniqueOrThrow).mockResolvedValue(updatedThread as never);
    vi.mocked(db.emailClassification.create).mockResolvedValue({ id: CLS_ID } as never);

    const res = await post(`/dev/workspaces/${WS_ID}/mock-inbox-event`, {
      mode: "existing_thread",
      threadId: THREAD_ID,
      senderEmail: "bob@example.com",
      bodyText: "Following up on my last message.",
    });

    expect(res.status).toBe(201);
    const body = await res.json() as Record<string, unknown>;
    expect(body.thread).toMatchObject({ id: THREAD_ID, isNew: false, messageCount: 2 });
    expect(db.emailThread.create).not.toHaveBeenCalled();
    expect(db.emailThread.findFirst).toHaveBeenCalledTimes(1);
    // update is called twice: once for messageCount, once for triageStatus
    expect(db.emailThread.update).toHaveBeenCalledTimes(2);
    expect(db.emailMessage.create).toHaveBeenCalledTimes(1);
    expect(db.emailClassification.create).toHaveBeenCalledTimes(1);
  });

  it("repeated incoming messages each create a new classification row", async () => {
    const twoMessages = [
      ...mockMessages,
      { subject: null, senderEmail: "bob@example.com", senderName: null, bodyText: "Second message", receivedAt: new Date() },
    ];
    vi.mocked(db.workspace.findUnique).mockResolvedValue(mockWorkspace as never);
    vi.mocked(db.emailThread.findFirst).mockResolvedValue(
      { id: THREAD_ID, emailAccountId: ACCOUNT_ID } as never
    );
    vi.mocked(db.emailMessage.create).mockResolvedValue({ id: MSG_ID } as never);
    vi.mocked(db.emailThread.update).mockResolvedValue(mockThread as never);
    vi.mocked(db.emailMessage.findMany).mockResolvedValue(twoMessages as never);
    vi.mocked(db.emailThread.findUniqueOrThrow).mockResolvedValue(
      { ...mockThread, messageCount: 2 } as never
    );
    vi.mocked(db.emailClassification.create).mockResolvedValue({ id: "cls-2" } as never);

    const res = await post(`/dev/workspaces/${WS_ID}/mock-inbox-event`, {
      mode: "existing_thread",
      threadId: THREAD_ID,
      senderEmail: "bob@example.com",
      bodyText: "Second message",
    });

    expect(res.status).toBe(201);
    // Each event creates exactly one new classification (history is accumulated in DB)
    expect(db.emailClassification.create).toHaveBeenCalledTimes(1);
  });

  it("returns 404 when thread not found", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue(mockWorkspace as never);
    vi.mocked(db.emailThread.findFirst).mockResolvedValue(null);

    const res = await post(`/dev/workspaces/${WS_ID}/mock-inbox-event`, {
      mode: "existing_thread",
      threadId: "nonexistent",
      senderEmail: "test@example.com",
      bodyText: "Hello",
    });

    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("Thread not found");
  });

  it("returns 400 when threadId is missing", async () => {
    const res = await post(`/dev/workspaces/${WS_ID}/mock-inbox-event`, {
      mode: "existing_thread",
      senderEmail: "test@example.com",
      bodyText: "Hello",
    });

    expect(res.status).toBe(400);
  });
});

// ─── AI classifier mode ───────────────────────────────────────────────────────

describe("ai classifier mode", () => {
  const AI_RESULT = {
    finalNodeId: "node-leaf",
    path: [],
    confidence: 0.88,
    explanation: "AI classified as Clients",
    needsHumanReview: false,
    decisionSource: "embedding_auto" as const,
    rawSimilarities: {},
    subtreeScores: {},
    updatedNodeEmbeddings: [],
  };

  beforeEach(() => {
    process.env["AI_PROVIDER"] = "ollama";
    process.env["OLLAMA_BASE_URL"] = "http://localhost:11434";
    process.env["OLLAMA_MODEL"] = "llama3.1:8b";
    mockSortThreadByEmbedding.mockResolvedValue(AI_RESULT);
  });

  afterEach(() => {
    delete process.env["AI_PROVIDER"];
    delete process.env["OLLAMA_BASE_URL"];
    delete process.env["OLLAMA_MODEL"];
  });

  it("uses AI provider when classifier=ai", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue(mockWorkspace as never);
    vi.mocked(db.emailThread.create).mockResolvedValue({ id: THREAD_ID } as never);
    vi.mocked(db.emailMessage.create).mockResolvedValue({ id: MSG_ID } as never);
    vi.mocked(db.emailMessage.findMany).mockResolvedValue(mockMessages as never);
    vi.mocked(db.emailThread.findUniqueOrThrow).mockResolvedValue(mockThread as never);
    vi.mocked(db.emailClassification.create).mockResolvedValue({ id: CLS_ID } as never);

    const res = await post(`/dev/workspaces/${WS_ID}/mock-inbox-event`, {
      mode: "new_thread",
      classifier: "ai",
      senderEmail: "test@example.com",
      bodyText: "Hello from AI",
    });

    expect(res.status).toBe(201);
    expect(mockSortThreadByEmbedding).toHaveBeenCalledTimes(1);
    const body = await res.json() as Record<string, unknown>;
    const cls = body.classification as Record<string, unknown>;
    expect(cls.modelProvider).toBe("test-provider");
    expect(cls.modelName).toBe("test-model");
  });

  it("sets triageStatus to NEEDS_REVIEW when AI returns needsHumanReview=true", async () => {
    mockSortThreadByEmbedding.mockResolvedValue({
      ...AI_RESULT,
      finalNodeId: null,
      needsHumanReview: true,
      explanation: "Cannot classify",
      decisionSource: "inbox_fallback",
    });

    vi.mocked(db.workspace.findUnique).mockResolvedValue(mockWorkspace as never);
    vi.mocked(db.emailThread.create).mockResolvedValue({ id: THREAD_ID } as never);
    vi.mocked(db.emailMessage.create).mockResolvedValue({ id: MSG_ID } as never);
    vi.mocked(db.emailMessage.findMany).mockResolvedValue(mockMessages as never);
    vi.mocked(db.emailThread.findUniqueOrThrow).mockResolvedValue(mockThread as never);
    vi.mocked(db.emailClassification.create).mockResolvedValue({ id: CLS_ID } as never);

    const res = await post(`/dev/workspaces/${WS_ID}/mock-inbox-event`, {
      mode: "new_thread",
      classifier: "ai",
      senderEmail: "test@example.com",
      bodyText: "Ambiguous email",
    });

    expect(res.status).toBe(201);
    expect(db.emailThread.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ triageStatus: "NEEDS_REVIEW" }) })
    );
  });
});
