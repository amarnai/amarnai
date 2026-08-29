import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { authed } from "./helpers.js";

vi.mock("@amarnai/db", () => {
  const db = {
    workspace: { findUnique: vi.fn() },
    workspaceMember: { findUnique: vi.fn() },
    emailConnection: { findUnique: vi.fn() },
    emailAccount: { upsert: vi.fn() },
    emailThread: { upsert: vi.fn(), update: vi.fn() },
    emailMessage: { upsert: vi.fn() },
    taxonomyNode: { findMany: vi.fn(), update: vi.fn() },
    taxonomyEdge: { findMany: vi.fn() },
    emailClassification: { create: vi.fn(), count: vi.fn() },
    // The classification row + meter now commit in one transaction; the mock runs
    // the callback with the same client so the create/meter mocks still fire.
    $transaction: vi.fn((cb: (tx: unknown) => unknown) => cb(db)),
  };
  return {
    Prisma: {},
    db,
    resolveInboxQuota: vi.fn(),
    recordMeterUsage: vi.fn(),
    threadSortDedupToken: (inboxKey: string, windowStart: Date, id: string) =>
      `THREAD_SORT_${inboxKey}_${windowStart.toISOString()}_${id}`,
    inboxKeyFor: vi.fn((addr: string) => addr),
    meterWindowStart: vi.fn(() => new Date("2026-07-01T00:00:00.000Z")),
  };
});

// Mock @amarnai/gmail so tests never make real HTTP calls. The sort route builds
// its client via createMailProvider(connection) (@amarnai/mail, unmocked), which
// constructs this GmailClient; the recent-threads dev endpoint uses it directly
// through ../services/gmail-client.js (a re-export of @amarnai/gmail).
vi.mock("@amarnai/gmail", () => ({
  GmailClient: vi.fn().mockImplementation(() => ({
    getThreadSnapshot: vi.fn(),
    listRecentThreads: vi.fn(),
  })),
  GmailAuthError: class GmailAuthError extends Error {},
  GmailHistoryCursorExpiredError: class GmailHistoryCursorExpiredError extends Error {},
  GmailThreadParseError: class GmailThreadParseError extends Error {},
  GmailThreadNotFoundError: class GmailThreadNotFoundError extends Error {},
  revokeGoogleToken: vi.fn(),
  normalizeGmailThread: vi.fn(),
  encrypt: vi.fn(),
  decrypt: vi.fn(),
  GMAIL_READONLY_SCOPE: "https://www.googleapis.com/auth/gmail.readonly",
  GmailApiError: class GmailApiError extends Error {},
  exchangeAuthCode: vi.fn(),
  exchangeServerAuthCode: vi.fn(),
  parseGrantedScopes: vi.fn(),
  fetchGmailProfile: vi.fn(),
  fetchGoogleUserInfo: vi.fn(),
}));

const mockSortThreadByEmbedding = vi.fn();
vi.mock("@amarnai/ai", () => ({
  getAIProviderConfig: vi.fn().mockReturnValue({}),
  getEmbeddingProviderConfig: vi.fn().mockReturnValue({}),
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
  // Mirrors the real predicate (packages/ai/src/thread-snapshot.ts), which is
  // unit-tested there and in the worker's filter tests.
  isDraftMessage: (m: { labelIds?: string[] }) => (m.labelIds ?? []).includes("DRAFT"),
}));

// The sort route enqueues a writeback reconcile; mock the queue so the real
// BullMQ/Redis instance is never constructed under test.
vi.mock("../queues.js", () => ({
  writebackThreadLabelQueue: { add: vi.fn().mockResolvedValue(undefined) },
}));

import app from "../app.js";
import { db, resolveInboxQuota, recordMeterUsage } from "@amarnai/db";
import { getThreadSortLimit } from "@amarnai/shared";
import { GmailClient, GmailThreadNotFoundError } from "@amarnai/gmail";

const FREE_LIMIT = getThreadSortLimit("FREE");

const WS_ID = "ws-1";

const BASE_WORKSPACE = { id: WS_ID, ownerUserId: "user-1" };

/**
 * Build a resolveInboxQuota result reporting `used` recurring sorts on the FREE
 * plan — the reset-immune inbox meter the sort gate reads.
 */
function quotaUsed(used: number) {
  return { inboxKey: "user@gmail.com", windowStart: new Date(), plan: "FREE" as const, used };
}

const BASE_CONNECTION = {
  id: "conn-1",
  provider: "GMAIL" as const,
  emailAddress: "user@gmail.com",
  subjectId: "google-sub-123",
  encryptedRefreshToken: "enc-token",
};

const BASE_NODES = [
  {
    id: "node-root",
    name: "Inbox",
    description: null,
    instructions: null,
    draftPrompt: null,
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
    draftPrompt: null,
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

// Normalized ThreadSnapshot as returned by client.getThreadSnapshot(). The route
// no longer sees raw Gmail JSON — the adapter normalizes it inside the client.
function makeSnapshot(threadId = "gmail-thread-1") {
  return {
    provider: "gmail" as const,
    providerThreadId: threadId,
    subject: "Test thread",
    participants: ["sender@example.com", "user@gmail.com"],
    latestMessageAt: new Date("2026-01-20T10:00:00.000Z"),
    messageCount: 1,
    messages: [
      {
        providerMessageId: "gmail-msg-1",
        senderEmail: "sender@example.com",
        senderName: "Sender",
        toEmails: ["user@gmail.com"],
        ccEmails: [],
        subject: "Test thread",
        bodyExcerpt: "Hello there",
        attachments: [],
        receivedAt: new Date("2026-01-20T10:00:00.000Z"),
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env["NODE_ENV"] = "development";
  process.env["AI_PROVIDER"] = "mock";

  vi.mocked(db.workspaceMember.findUnique).mockResolvedValue({ userId: "test-user-1" } as never);
  vi.mocked(db.workspace.findUnique).mockResolvedValue(BASE_WORKSPACE as never);
  vi.mocked(db.emailConnection.findUnique).mockResolvedValue(BASE_CONNECTION as never);
  vi.mocked(db.emailAccount.upsert).mockResolvedValue({ id: "acc-1" } as never);
  vi.mocked(db.emailThread.upsert).mockResolvedValue({ id: "thread-db-1" } as never);
  vi.mocked(db.emailMessage.upsert).mockResolvedValue({ id: "msg-db-1" } as never);
  vi.mocked(db.taxonomyNode.findMany).mockResolvedValue(BASE_NODES as never);
  vi.mocked(db.taxonomyEdge.findMany).mockResolvedValue(BASE_EDGES as never);
  vi.mocked(db.emailClassification.create).mockResolvedValue({ id: "cls-1" } as never);
  // Default: this thread has no prior metered classification this window, so the
  // sort records a fresh meter tick.
  vi.mocked(db.emailClassification.count).mockResolvedValue(0 as never);
  vi.mocked(db.emailThread.update).mockResolvedValue({} as never);
  // Well under the FREE limit by default so the quota check passes.
  vi.mocked(resolveInboxQuota).mockResolvedValue(quotaUsed(0));
  mockSortThreadByEmbedding.mockResolvedValue(VALID_CLASSIFY_RESULT);
});

afterEach(() => {
  delete process.env["AI_PROVIDER"];
});

function postSort(threadId = "gmail-thread-abc123") {
  return app.request(`/dev/workspaces/${WS_ID}/gmail-sort-thread`, authed({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gmailThreadId: threadId }),
  }));
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
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue(null);
    const res = await postSort();
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/no gmail inbox/i);
  });

  it("returns 429 when the reset-immune inbox meter is at the quota", async () => {
    // The reset-immune, inbox-pooled meter reports the FREE limit as full.
    // This is the reset-immunity guarantee: after a disconnect+reconnect
    // (resetWorkspaceData) wipes this workspace's EmailClassification rows, the
    // inbox meter still reads at-cap, so the sort stays blocked — quota cannot be
    // refunded by resetting. The check runs before the Gmail fetch + AI sort, so
    // neither should be attempted.
    vi.mocked(resolveInboxQuota).mockResolvedValue(quotaUsed(FREE_LIMIT));

    const res = await postSort();
    expect(res.status).toBe(429);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toMatch(/quota exceeded/i);
    expect(body.used).toBe(FREE_LIMIT);
    expect(body.limit).toBe(FREE_LIMIT);
    expect(typeof body.resetsAt).toBe("string");

    // The gate keys the meter off the connection's inbox address, so the
    // connection is resolved — but no sort work runs once over the cap.
    expect(resolveInboxQuota).toHaveBeenCalledWith("user@gmail.com", "THREAD_SORT", expect.any(Date));
    expect(mockSortThreadByEmbedding).not.toHaveBeenCalled();
    expect(db.emailClassification.create).not.toHaveBeenCalled();
    // Over the cap, nothing is sorted, so no meter tick is recorded.
    expect(recordMeterUsage).not.toHaveBeenCalled();
  });

  it("proceeds with the sort when usage is below the limit", async () => {
    vi.mocked(resolveInboxQuota).mockResolvedValue(quotaUsed(FREE_LIMIT - 1));
    vi.mocked(GmailClient).mockImplementationOnce(() => ({
      getThreadSnapshot: vi.fn().mockResolvedValue(makeSnapshot()),
      listRecentThreads: vi.fn(),
    }) as never);

    const res = await postSort("gmail-thread-1");
    expect(res.status).toBe(201);
    expect(mockSortThreadByEmbedding).toHaveBeenCalledOnce();
  });

  it("records a THREAD_SORT meter tick on the same counter it gates on", async () => {
    // Closes the pre-check/accounting loop: this inline sort must increment the
    // reset-immune inbox meter (keyed off the connection address), not just the
    // deletable EmailClassification row — otherwise the gate above never sees it.
    vi.mocked(GmailClient).mockImplementationOnce(() => ({
      getThreadSnapshot: vi.fn().mockResolvedValue(makeSnapshot()),
      listRecentThreads: vi.fn(),
    }) as never);

    const res = await postSort("gmail-thread-1");
    expect(res.status).toBe(201);
    // Committed atomically with the classification row (one transaction) and keyed
    // on a deterministic per-thread token so a crash can't leave the row without the
    // meter and a concurrent duplicate can't double-count.
    expect(db.$transaction).toHaveBeenCalled();
    expect(recordMeterUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        inboxKey: "user@gmail.com",
        kind: "THREAD_SORT",
        delta: 1,
        dedupToken: "THREAD_SORT_user@gmail.com_2026-07-01T00:00:00.000Z_thread-db-1",
        tx: expect.anything(),
      })
    );
  });

  it("does not double-count a thread already metered this window", async () => {
    // A prior recurring classification exists for this thread this window, so a
    // re-sort is free — distinct-thread semantics, mirroring the classify worker.
    vi.mocked(db.emailClassification.count).mockResolvedValue(1 as never);
    vi.mocked(GmailClient).mockImplementationOnce(() => ({
      getThreadSnapshot: vi.fn().mockResolvedValue(makeSnapshot()),
      listRecentThreads: vi.fn(),
    }) as never);

    const res = await postSort("gmail-thread-1");
    expect(res.status).toBe(201);
    expect(recordMeterUsage).not.toHaveBeenCalled();
  });

  it("returns 400 when gmailThreadId is missing", async () => {
    const res = await app.request(`/dev/workspaces/${WS_ID}/gmail-sort-thread`, authed({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when gmailThreadId contains invalid characters", async () => {
    const res = await postSort("../../etc/passwd");
    expect(res.status).toBe(400);
  });

  it("returns 404 when Gmail reports the thread as gone (typed not-found)", async () => {
    // GmailClient is constructed fresh per request — set up mock after clearing
    vi.mocked(GmailClient).mockImplementationOnce(() => ({
      getThreadSnapshot: vi
        .fn()
        .mockRejectedValue(new GmailThreadNotFoundError("Gmail thread not found: xyz")),
      listRecentThreads: vi.fn(),
    }) as never);

    const res = await postSort();
    expect(res.status).toBe(404);
  });

  it("returns 502 when Gmail API fails with a non-404 error", async () => {
    vi.mocked(GmailClient).mockImplementationOnce(() => ({
      getThreadSnapshot: vi.fn().mockRejectedValue(new Error("Gmail thread fetch failed: 403")),
      listRecentThreads: vi.fn(),
    }) as never);

    const res = await postSort();
    expect(res.status).toBe(502);
  });

  it("returns 502 (not 404) for a transient error whose message contains 'not found'", async () => {
    vi.mocked(GmailClient).mockImplementationOnce(() => ({
      getThreadSnapshot: vi
        .fn()
        .mockRejectedValue(new Error("upstream host not found (transient DNS failure)")),
      listRecentThreads: vi.fn(),
    }) as never);

    const res = await postSort();
    expect(res.status).toBe(502);
  });

  it("fetches thread, upserts thread and messages, persists classification, returns 201", async () => {
    vi.mocked(GmailClient).mockImplementationOnce(() => ({
      getThreadSnapshot: vi.fn().mockResolvedValue(makeSnapshot()),
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
      getThreadSnapshot: vi.fn().mockResolvedValue(makeSnapshot()),
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
        getThreadSnapshot: vi.fn().mockResolvedValue(makeSnapshot()),
        listRecentThreads: vi.fn(),
      }) as never)
      .mockImplementationOnce(() => ({
        getThreadSnapshot: vi.fn().mockResolvedValue(makeSnapshot()),
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
      getThreadSnapshot: vi.fn().mockResolvedValue(makeSnapshot()),
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

  it("drops an unsent draft from the thread before persisting or sorting", async () => {
    // Gmail returns drafts as thread members. An Amarnai Reply draft would
    // otherwise be stored as a message and become the newest content the sorter
    // and every later summary/draft prompt sees.
    const withDraft = makeSnapshot();
    withDraft.messages.push({
      providerMessageId: "gmail-draft-1",
      senderEmail: "user@gmail.com",
      senderName: "User",
      toEmails: ["sender@example.com"],
      ccEmails: [],
      subject: "Re: Test thread",
      bodyExcerpt: "My unsent reply",
      attachments: [],
      receivedAt: new Date("2026-01-21T10:00:00.000Z"),
      labelIds: ["DRAFT"],
    } as never);
    withDraft.messageCount = 2;
    withDraft.latestMessageAt = new Date("2026-01-21T10:00:00.000Z");

    vi.mocked(GmailClient).mockImplementationOnce(() => ({
      getThreadSnapshot: vi.fn().mockResolvedValue(withDraft),
      listRecentThreads: vi.fn(),
    }) as never);

    const res = await postSort("gmail-thread-1");
    expect(res.status).toBe(201);

    // Only the real message is written.
    expect(db.emailMessage.upsert).toHaveBeenCalledTimes(1);
    expect(db.emailMessage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          emailAccountId_providerMessageId: expect.objectContaining({
            providerMessageId: "gmail-msg-1",
          }),
        }),
      })
    );

    // The thread's count and date come from the real messages, so composing a
    // draft never bumps the thread or inflates its message count.
    expect(db.emailThread.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          messageCount: 1,
          latestMessageAt: new Date("2026-01-20T10:00:00.000Z"),
        }),
      })
    );
  });

  it("returns 422 when no taxonomy nodes exist", async () => {
    vi.mocked(GmailClient).mockImplementationOnce(() => ({
      getThreadSnapshot: vi.fn().mockResolvedValue(makeSnapshot()),
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

    const res = await app.request(`/dev/workspaces/other-ws/gmail-sort-thread`, authed({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gmailThreadId: "gmail-thread-abc" }),
    }));
    expect(res.status).toBe(404);
  });

  it("resolves finalNodeName from taxonomy nodes", async () => {
    vi.mocked(GmailClient).mockImplementationOnce(() => ({
      getThreadSnapshot: vi.fn().mockResolvedValue(makeSnapshot()),
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

    const res = await app.request(`/dev/workspaces/${WS_ID}/gmail-recent-threads`, authed());
    expect(res.status).toBe(404);

    delete process.env["ENABLE_DEV_TOOLS"];
    process.env["NODE_ENV"] = "development";
  });

  it("returns 404 when workspace does not exist", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue(null);
    const res = await app.request(`/dev/workspaces/${WS_ID}/gmail-recent-threads`, authed());
    expect(res.status).toBe(404);
  });

  it("returns 422 when no Gmail connection exists", async () => {
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue(null);
    const res = await app.request(`/dev/workspaces/${WS_ID}/gmail-recent-threads`, authed());
    expect(res.status).toBe(422);
  });

  it("returns threads from GmailClient.listRecentThreads", async () => {
    const mockThreads = [
      { id: "t1", subject: "Thread 1" },
      { id: "t2", subject: null },
      { id: "t3", subject: "Thread 3" },
    ];
    vi.mocked(GmailClient).mockImplementationOnce(() => ({
      getThreadSnapshot: vi.fn(),
      listRecentThreads: vi.fn().mockResolvedValue(mockThreads),
    }) as never);

    const res = await app.request(`/dev/workspaces/${WS_ID}/gmail-recent-threads`, authed());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { threads: Array<{ id: string; subject: string | null }> };
    expect(body.threads).toEqual(mockThreads);
  });

  it("returns 502 when Gmail API listing fails", async () => {
    vi.mocked(GmailClient).mockImplementationOnce(() => ({
      getThreadSnapshot: vi.fn(),
      listRecentThreads: vi.fn().mockRejectedValue(new Error("Gmail threads list failed: 401")),
    }) as never);

    const res = await app.request(`/dev/workspaces/${WS_ID}/gmail-recent-threads`, authed());
    expect(res.status).toBe(502);
  });
});
