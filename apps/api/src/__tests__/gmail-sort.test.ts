import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

vi.mock("@amarnai/db", () => ({
  Prisma: {},
  db: {
    workspace: { findUnique: vi.fn() },
    gmailConnection: { findUnique: vi.fn() },
    emailAccount: { upsert: vi.fn() },
    emailThread: { upsert: vi.fn(), update: vi.fn() },
    emailMessage: { upsert: vi.fn() },
    taxonomyNode: { findMany: vi.fn(), update: vi.fn() },
    taxonomyEdge: { findMany: vi.fn() },
    emailClassification: { create: vi.fn() },
  },
}));

// Mock GmailClient so tests never make real HTTP calls
vi.mock("../services/gmail-client.js", () => ({
  GmailClient: vi.fn().mockImplementation(() => ({
    getThread: vi.fn(),
    listRecentThreads: vi.fn(),
  })),
}));

const mockSortThreadByEmbedding = vi.fn();
vi.mock("@amarnai/ai", () => ({
  createAIProvider: vi.fn().mockReturnValue({
    providerName: "mock",
    modelName: "mock-v1",
  }),
  createEmbeddingProvider: vi.fn().mockReturnValue({
    providerName: "mock-embedding",
    modelName: "mock-embedding-v1",
    embed: vi.fn(),
  }),
  sortThreadByEmbedding: (...args: unknown[]) => mockSortThreadByEmbedding(...args),
  snapshotToThreadMessages: vi.fn().mockReturnValue([]),
}));

import app from "../app.js";
import { db } from "@amarnai/db";
import { GmailClient } from "../services/gmail-client.js";

const WS_ID = "ws-1";

const BASE_WORKSPACE = { id: WS_ID, ownerUserId: "user-1" };

const BASE_CONNECTION = {
  id: "conn-1",
  gmailAddress: "user@gmail.com",
  googleSubjectId: "google-sub-123",
  encryptedRefreshToken: "enc-token",
};

const BASE_NODES = [
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

const BASE_EDGES = [
  {
    id: "edge-1",
    sourceNodeId: "node-root",
    targetNodeId: "node-leaf",
  },
];

const VALID_CLASSIFY_RESULT = {
  finalNodeId: "node-leaf",
  path: [
    {
      edgeId: "edge-1",
      sourceNodeId: "node-root",
      targetNodeId: "node-leaf",
      confidence: 0.9,
      explanation: "Client email",
    },
  ],
  confidence: 0.9,
  explanation: "Client email",
  needsHumanReview: false,
  decisionSource: "embedding_auto" as const,
  rawSimilarities: {},
  subtreeScores: {},
  updatedNodeEmbeddings: [],
};

// Minimal raw Gmail thread to feed to normalizeGmailThread
function makeRawThread(threadId = "gmail-thread-1") {
  const body = Buffer.from("Hello there")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");

  return {
    id: threadId,
    messages: [
      {
        id: "gmail-msg-1",
        threadId,
        payload: {
          mimeType: "text/plain",
          headers: [
            { name: "From", value: "Sender <sender@example.com>" },
            { name: "To", value: "user@gmail.com" },
            { name: "Subject", value: "Test thread" },
            { name: "Date", value: "Mon, 20 Jan 2026 10:00:00 +0000" },
          ],
          body: { size: body.length, data: body },
        },
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env["NODE_ENV"] = "development";
  process.env["AI_PROVIDER"] = "mock";

  vi.mocked(db.workspace.findUnique).mockResolvedValue(BASE_WORKSPACE as never);
  vi.mocked(db.gmailConnection.findUnique).mockResolvedValue(BASE_CONNECTION as never);
  vi.mocked(db.emailAccount.upsert).mockResolvedValue({ id: "acc-1" } as never);
  vi.mocked(db.emailThread.upsert).mockResolvedValue({ id: "thread-db-1" } as never);
  vi.mocked(db.emailMessage.upsert).mockResolvedValue({ id: "msg-db-1" } as never);
  vi.mocked(db.taxonomyNode.findMany).mockResolvedValue(BASE_NODES as never);
  vi.mocked(db.taxonomyEdge.findMany).mockResolvedValue(BASE_EDGES as never);
  vi.mocked(db.emailClassification.create).mockResolvedValue({ id: "cls-1" } as never);
  vi.mocked(db.emailThread.update).mockResolvedValue({} as never);
  mockSortThreadByEmbedding.mockResolvedValue(VALID_CLASSIFY_RESULT);
});

afterEach(() => {
  delete process.env["AI_PROVIDER"];
});

function postSort(threadId = "gmail-thread-abc123") {
  return app.request(`/dev/workspaces/${WS_ID}/gmail-sort-thread`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gmailThreadId: threadId }),
  });
}

// ─── POST /dev/workspaces/:workspaceId/gmail-sort-thread ──────────────────────

describe("POST /dev/workspaces/:workspaceId/gmail-sort-thread", () => {
  it("returns 404 when dev tools are disabled", async () => {
    process.env["NODE_ENV"] = "production";
    process.env["ENABLE_DEV_TOOLS"] = "false";

    const res = await postSort();
    expect(res.status).toBe(404);

    delete process.env["ENABLE_DEV_TOOLS"];
    process.env["NODE_ENV"] = "development";
  });

  it("returns 404 when workspace does not exist", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue(null);
    const res = await postSort();
    expect(res.status).toBe(404);
  });

  it("returns 422 when no Gmail connection exists", async () => {
    vi.mocked(db.gmailConnection.findUnique).mockResolvedValue(null);
    const res = await postSort();
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/no gmail inbox/i);
  });

  it("returns 400 when gmailThreadId is missing", async () => {
    const res = await app.request(`/dev/workspaces/${WS_ID}/gmail-sort-thread`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when gmailThreadId contains invalid characters", async () => {
    const res = await postSort("../../etc/passwd");
    expect(res.status).toBe(400);
  });

  it("returns 404 when Gmail API says thread not found", async () => {
    // GmailClient is constructed fresh per request — set up mock after clearing
    vi.mocked(GmailClient).mockImplementationOnce(() => ({
      getThread: vi.fn().mockRejectedValue(new Error("Gmail thread not found: xyz")),
      listRecentThreads: vi.fn(),
    }) as never);

    const res = await postSort();
    expect(res.status).toBe(404);
  });

  it("returns 502 when Gmail API fails with a non-404 error", async () => {
    vi.mocked(GmailClient).mockImplementationOnce(() => ({
      getThread: vi.fn().mockRejectedValue(new Error("Gmail thread fetch failed: 403")),
      listRecentThreads: vi.fn(),
    }) as never);

    const res = await postSort();
    expect(res.status).toBe(502);
  });

  it("fetches thread, upserts thread and messages, persists classification, returns 201", async () => {
    vi.mocked(GmailClient).mockImplementationOnce(() => ({
      getThread: vi.fn().mockResolvedValue(makeRawThread()),
      listRecentThreads: vi.fn(),
    }) as never);

    const res = await postSort("gmail-thread-1");
    expect(res.status).toBe(201);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty("snapshot");
    expect(body).toHaveProperty("classification");
    expect((body.classification as Record<string, unknown>).id).toBe("cls-1");
    expect(db.emailThread.upsert).toHaveBeenCalledTimes(1);
    expect(db.emailClassification.create).toHaveBeenCalledTimes(1);
  });

  it("does not persist bodyText on EmailMessage records", async () => {
    vi.mocked(GmailClient).mockImplementationOnce(() => ({
      getThread: vi.fn().mockResolvedValue(makeRawThread()),
      listRecentThreads: vi.fn(),
    }) as never);

    await postSort("gmail-thread-1");

    expect(db.emailMessage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ bodyText: null }),
      })
    );
  });

  it("upserts EmailThread so repeated sorts do not duplicate rows", async () => {
    vi.mocked(GmailClient)
      .mockImplementationOnce(() => ({
        getThread: vi.fn().mockResolvedValue(makeRawThread()),
        listRecentThreads: vi.fn(),
      }) as never)
      .mockImplementationOnce(() => ({
        getThread: vi.fn().mockResolvedValue(makeRawThread()),
        listRecentThreads: vi.fn(),
      }) as never);

    await postSort("gmail-thread-1");
    await postSort("gmail-thread-1");

    // upsert called twice but creates/updates the same row
    expect(db.emailThread.upsert).toHaveBeenCalledTimes(2);
    // Two classifications (each sort adds a new one)
    expect(db.emailClassification.create).toHaveBeenCalledTimes(2);
  });

  it("sets triageStatus to NEEDS_REVIEW when needsHumanReview is true", async () => {
    vi.mocked(GmailClient).mockImplementationOnce(() => ({
      getThread: vi.fn().mockResolvedValue(makeRawThread()),
      listRecentThreads: vi.fn(),
    }) as never);

    mockSortThreadByEmbedding.mockResolvedValue({
      ...VALID_CLASSIFY_RESULT,
      finalNodeId: null,
      needsHumanReview: true,
      confidence: 0.2,
      decisionSource: "inbox_fallback",
    });

    const res = await postSort("gmail-thread-1");
    expect(res.status).toBe(201);
    expect(db.emailThread.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ triageStatus: "NEEDS_REVIEW" }) })
    );
  });

  it("returns 422 when no taxonomy nodes exist", async () => {
    vi.mocked(GmailClient).mockImplementationOnce(() => ({
      getThread: vi.fn().mockResolvedValue(makeRawThread()),
      listRecentThreads: vi.fn(),
    }) as never);
    vi.mocked(db.taxonomyNode.findMany).mockResolvedValue([] as never);

    const res = await postSort("gmail-thread-1");
    expect(res.status).toBe(422);
  });

  it("scopes workspace check so workspaceId is always enforced", async () => {
    vi.mocked(db.workspace.findUnique).mockImplementation((async (args: unknown) => {
      const a = args as { where: { id: string } };
      return a.where.id === WS_ID ? BASE_WORKSPACE : null;
    }) as never);

    const res = await app.request(`/dev/workspaces/other-ws/gmail-sort-thread`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gmailThreadId: "gmail-thread-abc" }),
    });
    expect(res.status).toBe(404);
  });

  it("resolves finalNodeName from taxonomy nodes", async () => {
    vi.mocked(GmailClient).mockImplementationOnce(() => ({
      getThread: vi.fn().mockResolvedValue(makeRawThread()),
      listRecentThreads: vi.fn(),
    }) as never);

    const res = await postSort("gmail-thread-1");
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    const cls = body.classification as Record<string, unknown>;
    expect(cls.finalNodeName).toBe("Clients");
  });
});

// ─── GET /dev/workspaces/:workspaceId/gmail-recent-threads ────────────────────

describe("GET /dev/workspaces/:workspaceId/gmail-recent-threads", () => {
  it("returns 404 when dev tools are disabled", async () => {
    process.env["NODE_ENV"] = "production";
    process.env["ENABLE_DEV_TOOLS"] = "false";

    const res = await app.request(`/dev/workspaces/${WS_ID}/gmail-recent-threads`);
    expect(res.status).toBe(404);

    delete process.env["ENABLE_DEV_TOOLS"];
    process.env["NODE_ENV"] = "development";
  });

  it("returns 404 when workspace does not exist", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue(null);
    const res = await app.request(`/dev/workspaces/${WS_ID}/gmail-recent-threads`);
    expect(res.status).toBe(404);
  });

  it("returns 422 when no Gmail connection exists", async () => {
    vi.mocked(db.gmailConnection.findUnique).mockResolvedValue(null);
    const res = await app.request(`/dev/workspaces/${WS_ID}/gmail-recent-threads`);
    expect(res.status).toBe(422);
  });

  it("returns threads from GmailClient.listRecentThreads", async () => {
    const mockThreads = [
      { id: "t1", subject: "Thread 1" },
      { id: "t2", subject: null },
      { id: "t3", subject: "Thread 3" },
    ];
    vi.mocked(GmailClient).mockImplementationOnce(() => ({
      getThread: vi.fn(),
      listRecentThreads: vi.fn().mockResolvedValue(mockThreads),
    }) as never);

    const res = await app.request(`/dev/workspaces/${WS_ID}/gmail-recent-threads`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { threads: Array<{ id: string; subject: string | null }> };
    expect(body.threads).toEqual(mockThreads);
  });

  it("returns 502 when Gmail API listing fails", async () => {
    vi.mocked(GmailClient).mockImplementationOnce(() => ({
      getThread: vi.fn(),
      listRecentThreads: vi.fn().mockRejectedValue(new Error("Gmail threads list failed: 401")),
    }) as never);

    const res = await app.request(`/dev/workspaces/${WS_ID}/gmail-recent-threads`);
    expect(res.status).toBe(502);
  });
});
