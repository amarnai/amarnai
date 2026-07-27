import { vi, describe, it, expect, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import { authed } from "./helpers.js";

const mockBilling = vi.hoisted(() => ({ enforceSummaryQuota: true }));
const { mockResolveInboxQuota, mockRecordMeterUsage, mockGenerateThreadSummary, mockCreateAIProvider } =
  vi.hoisted(() => ({
    mockResolveInboxQuota: vi.fn(),
    mockRecordMeterUsage: vi.fn(),
    mockGenerateThreadSummary: vi.fn(),
    mockCreateAIProvider: vi.fn(),
  }));

vi.mock("@amarnai/config", () => ({
  config: {
    redis: { url: "redis://localhost:6379" },
    billing: mockBilling,
    internalApiSecret: "dev-internal-secret",
  },
}));

vi.mock("@amarnai/db", () => ({
  Prisma: {},
  db: {
    emailThread: { findFirst: vi.fn() },
    emailAccount: { findMany: vi.fn() },
    workspace: { findUnique: vi.fn() },
    workspaceMember: { findUnique: vi.fn() },
    emailConnection: { findUnique: vi.fn() },
    threadSummary: { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn() },
    inboxUsageMeter: { findUnique: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  },
  resolveInboxQuota: mockResolveInboxQuota,
  recordMeterUsage: mockRecordMeterUsage,
  messageSetSignature: (ids: string[]) =>
    createHash("sha1").update([...ids].sort().join(",")).digest("hex").slice(0, 16),
}));

const SUMMARY_PROMPT_VERSION = "2";

vi.mock("@amarnai/ai", () => ({
  createAIProvider: mockCreateAIProvider,
  generateThreadSummary: mockGenerateThreadSummary,
  getSummaryAIProviderConfig: () => ({ provider: "mock" }),
  SUMMARY_PROMPT_VERSION: "2",
}));

const { mockGetThreadSnapshot } = vi.hoisted(() => ({ mockGetThreadSnapshot: vi.fn() }));

vi.mock("@amarnai/mail", () => ({
  createMailProvider: () => ({ getThreadSnapshot: mockGetThreadSnapshot }),
}));

import app from "../app.js";
import { db } from "@amarnai/db";
import { getThreadSummaryLimit } from "@amarnai/shared";

const FREE_LIMIT = getThreadSummaryLimit("FREE");

const WS_ID = "ws-1";
const THREAD_ID = "thread-1";
const PROVIDER_THREAD_ID = "18f0abc123";

function messageAt(providerMessageId: string, hour: number) {
  return {
    providerMessageId,
    subject: "Kickoff",
    senderEmail: "ana@acme.com",
    senderName: "Ana",
    bodyText: "Body text",
    snippet: `snippet for ${providerMessageId}`,
    receivedAt: new Date(Date.UTC(2026, 6, 1, hour)),
  };
}

/** A normal multi-message, non-automated thread: the LLM path. */
function multiMessageThread() {
  return {
    id: THREAD_ID,
    subject: "Kickoff",
    isAutomated: false,
    providerThreadId: PROVIDER_THREAD_ID,
    messages: [messageAt("m1", 9), messageAt("m2", 10)],
  };
}

const SIGNATURE = createHash("sha1").update("m1,m2").digest("hex").slice(0, 16);

function post(path: string, headers: Record<string, string> = {}) {
  return app.request(path, authed({ method: "POST", headers }));
}

/** Run the transaction callback against a tx double backed by the db mocks. */
function wireTransaction() {
  vi.mocked(db.$transaction).mockImplementation(async (fn: unknown) =>
    (fn as (tx: unknown) => Promise<unknown>)({
      $queryRaw: db.$queryRaw,
      threadSummary: db.threadSummary,
      inboxUsageMeter: db.inboxUsageMeter,
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockBilling.enforceSummaryQuota = true;

  vi.mocked(db.workspaceMember.findUnique).mockResolvedValue({ userId: "test-user-1" } as never);
  vi.mocked(db.emailThread.findFirst).mockResolvedValue(multiMessageThread() as never);
  vi.mocked(db.workspace.findUnique).mockResolvedValue({ locale: "en" } as never);
  vi.mocked(db.emailConnection.findUnique).mockResolvedValue({
    provider: "GMAIL",
    emailAddress: "ben@gmail.com",
    encryptedRefreshToken: "enc-token",
  } as never);
  mockGetThreadSnapshot.mockResolvedValue({
    messages: [
      { providerMessageId: "m1", bodyExcerpt: "live body one" },
      { providerMessageId: "m2", bodyExcerpt: "live body two" },
    ],
  });
  vi.mocked(db.threadSummary.findUnique).mockResolvedValue(null as never);
  vi.mocked(db.threadSummary.upsert).mockResolvedValue({} as never);
  vi.mocked(db.threadSummary.update).mockResolvedValue({} as never);
  vi.mocked(db.inboxUsageMeter.findUnique).mockResolvedValue(null as never);
  vi.mocked(db.emailAccount.findMany).mockResolvedValue([{ id: "acc-1" }] as never);
  vi.mocked(db.$queryRaw).mockResolvedValue([] as never);
  wireTransaction();

  mockResolveInboxQuota.mockResolvedValue({
    inboxKey: "ben@gmail.com",
    windowStart: new Date(Date.UTC(2026, 6, 1)),
    plan: "FREE",
    used: 0,
  });
  mockCreateAIProvider.mockReturnValue({ providerName: "mock", modelName: "mock-1" });
  mockGenerateThreadSummary.mockResolvedValue({
    format: "PROSE",
    text: "Ana wants the kickoff date.",
    bullets: [],
  });
});

describe("POST /workspaces/:workspaceId/email-threads/:threadId/summary", () => {
  it("404s when the thread is not in the workspace", async () => {
    vi.mocked(db.emailThread.findFirst).mockResolvedValue(null as never);
    const res = await post(`/workspaces/${WS_ID}/email-threads/${THREAD_ID}/summary`);
    expect(res.status).toBe(404);
    expect(mockGenerateThreadSummary).not.toHaveBeenCalled();
  });

  it("generates, stores, and meters on a cache miss", async () => {
    const res = await post(`/workspaces/${WS_ID}/email-threads/${THREAD_ID}/summary`);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      kind: "summary",
      format: "PROSE",
      summary: "Ana wants the kickoff date.",
      bullets: [],
      locale: "en",
    });
    expect(db.threadSummary.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "READY", summary: "Ana wants the kickoff date." }),
      }),
    );
    expect(mockRecordMeterUsage).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "THREAD_SUMMARY", delta: 1 }),
    );
  });

  // The DB stores bodyText: null by policy ("store minimal email data"), so the
  // bodies MUST come from a live provider fetch — the prod bug was a summary of
  // six empty bodies reading "no body content in any of the messages".
  it("feeds live provider bodies to the LLM, not the (null) stored bodyText", async () => {
    await post(`/workspaces/${WS_ID}/email-threads/${THREAD_ID}/summary`);
    expect(mockGetThreadSnapshot).toHaveBeenCalledWith(PROVIDER_THREAD_ID);
    const messages = mockGenerateThreadSummary.mock.calls[0]![1] as Array<{ bodyText: string }>;
    expect(messages.map((m) => m.bodyText)).toEqual(["live body one", "live body two"]);
  });

  it("falls back to the stored snippet when the provider fetch fails", async () => {
    mockGetThreadSnapshot.mockRejectedValue(new Error("gmail down"));
    vi.mocked(db.emailThread.findFirst).mockResolvedValue({
      ...multiMessageThread(),
      messages: [
        { ...messageAt("m1", 9), bodyText: null },
        { ...messageAt("m2", 10), bodyText: null },
      ],
    } as never);
    const res = await post(`/workspaces/${WS_ID}/email-threads/${THREAD_ID}/summary`);
    expect(res.status).toBe(201);
    const messages = mockGenerateThreadSummary.mock.calls[0]![1] as Array<{ bodyText: string }>;
    expect(messages.map((m) => m.bodyText)).toEqual(["snippet for m1", "snippet for m2"]);
  });

  it("does not attempt a provider fetch on the mock/dev path (no connection)", async () => {
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue(null as never);
    const res = await post(`/workspaces/${WS_ID}/email-threads/${THREAD_ID}/summary`);
    expect(res.status).toBe(201);
    expect(mockGetThreadSnapshot).not.toHaveBeenCalled();
    // Stored bodyText (the mock inbox does persist bodies) still reaches the LLM.
    const messages = mockGenerateThreadSummary.mock.calls[0]![1] as Array<{ bodyText: string }>;
    expect(messages.map((m) => m.bodyText)).toEqual(["Body text", "Body text"]);
  });

  it("stores the signature of the current message set on the placeholder", async () => {
    await post(`/workspaces/${WS_ID}/email-threads/${THREAD_ID}/summary`);
    expect(db.threadSummary.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ messageSetSignature: SIGNATURE, status: "GENERATING" }),
      }),
    );
  });

  // ── Snippet-only gate ───────────────────────────────────────────────────────

  it("returns the stored snippet for a single-message thread without calling the LLM", async () => {
    vi.mocked(db.emailThread.findFirst).mockResolvedValue({
      id: THREAD_ID,
      subject: "Kickoff",
      isAutomated: false,
      messages: [messageAt("m1", 9)],
    } as never);
    const res = await post(`/workspaces/${WS_ID}/email-threads/${THREAD_ID}/summary`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ kind: "snippet", snippet: "snippet for m1" });
    expect(mockGenerateThreadSummary).not.toHaveBeenCalled();
    expect(db.threadSummary.upsert).not.toHaveBeenCalled();
    expect(mockRecordMeterUsage).not.toHaveBeenCalled();
  });

  it("returns the stored snippet for an automated thread without calling the LLM", async () => {
    vi.mocked(db.emailThread.findFirst).mockResolvedValue({
      ...multiMessageThread(),
      isAutomated: true,
    } as never);
    const res = await post(`/workspaces/${WS_ID}/email-threads/${THREAD_ID}/summary`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ kind: "snippet", snippet: "snippet for m2" });
    expect(mockGenerateThreadSummary).not.toHaveBeenCalled();
    expect(mockRecordMeterUsage).not.toHaveBeenCalled();
  });

  // ── Cache + invalidation ────────────────────────────────────────────────────

  it("serves a cached READY summary without calling the LLM or metering", async () => {
    vi.mocked(db.threadSummary.findUnique).mockResolvedValue({
      status: "READY",
      summary: "Cached text.",
      bullets: [],
      format: "PROSE",
      promptVersion: SUMMARY_PROMPT_VERSION,
      locale: "en",
      messageSetSignature: SIGNATURE,
      generatedAt: new Date(Date.UTC(2026, 6, 2)),
      updatedAt: new Date(Date.UTC(2026, 6, 2)),
    } as never);
    const res = await post(`/workspaces/${WS_ID}/email-threads/${THREAD_ID}/summary`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ kind: "summary", summary: "Cached text." });
    expect(mockGenerateThreadSummary).not.toHaveBeenCalled();
    expect(mockRecordMeterUsage).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("regenerates when the message set changed (a new message arrived)", async () => {
    vi.mocked(db.threadSummary.findUnique).mockResolvedValue({
      status: "READY",
      summary: "Stale text.",
      bullets: [],
      format: "PROSE",
      promptVersion: SUMMARY_PROMPT_VERSION,
      locale: "en",
      messageSetSignature: "0000000000000000",
      generatedAt: new Date(Date.UTC(2026, 6, 2)),
      updatedAt: new Date(Date.UTC(2026, 6, 2)),
    } as never);
    const res = await post(`/workspaces/${WS_ID}/email-threads/${THREAD_ID}/summary`);
    expect(res.status).toBe(201);
    expect(mockGenerateThreadSummary).toHaveBeenCalledOnce();
  });

  it("regenerates when the workspace locale changed", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({ locale: "fr" } as never);
    vi.mocked(db.threadSummary.findUnique).mockResolvedValue({
      status: "READY",
      summary: "English text.",
      bullets: [],
      format: "PROSE",
      promptVersion: SUMMARY_PROMPT_VERSION,
      locale: "en",
      messageSetSignature: SIGNATURE,
      generatedAt: new Date(Date.UTC(2026, 6, 2)),
      updatedAt: new Date(Date.UTC(2026, 6, 2)),
    } as never);
    const res = await post(`/workspaces/${WS_ID}/email-threads/${THREAD_ID}/summary`);
    expect(res.status).toBe(201);
    expect(mockGenerateThreadSummary).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ targetLanguage: "French" }),
    );
  });

  it("bypasses the cache when X-Force-Regenerate is set", async () => {
    vi.mocked(db.threadSummary.findUnique).mockResolvedValue({
      status: "READY",
      summary: "Cached text.",
      bullets: [],
      format: "PROSE",
      promptVersion: SUMMARY_PROMPT_VERSION,
      locale: "en",
      messageSetSignature: SIGNATURE,
      generatedAt: new Date(Date.UTC(2026, 6, 2)),
      updatedAt: new Date(Date.UTC(2026, 6, 2)),
    } as never);
    const res = await post(`/workspaces/${WS_ID}/email-threads/${THREAD_ID}/summary`, {
      "X-Force-Regenerate": "1",
    });
    expect(res.status).toBe(201);
    expect(mockGenerateThreadSummary).toHaveBeenCalledOnce();
  });

  it("returns 202 while a fresh generation is in flight", async () => {
    vi.mocked(db.threadSummary.findUnique).mockResolvedValue({
      status: "GENERATING",
      summary: null,
      bullets: [],
      format: "PROSE",
      promptVersion: SUMMARY_PROMPT_VERSION,
      locale: "en",
      messageSetSignature: SIGNATURE,
      generatedAt: null,
      updatedAt: new Date(),
    } as never);
    const res = await post(`/workspaces/${WS_ID}/email-threads/${THREAD_ID}/summary`);
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ generating: true });
    expect(mockGenerateThreadSummary).not.toHaveBeenCalled();
  });

  it("retries past a stale GENERATING row instead of polling forever", async () => {
    vi.mocked(db.threadSummary.findUnique).mockResolvedValue({
      status: "GENERATING",
      summary: null,
      bullets: [],
      format: "PROSE",
      promptVersion: SUMMARY_PROMPT_VERSION,
      locale: "en",
      messageSetSignature: SIGNATURE,
      generatedAt: null,
      updatedAt: new Date(Date.now() - 10 * 60 * 1_000),
    } as never);
    const res = await post(`/workspaces/${WS_ID}/email-threads/${THREAD_ID}/summary`);
    expect(res.status).toBe(201);
  });

  // ── Failures ────────────────────────────────────────────────────────────────

  it("marks the row FAILED and does not meter when the LLM returns invalid output", async () => {
    mockGenerateThreadSummary.mockResolvedValue(null);
    const res = await post(`/workspaces/${WS_ID}/email-threads/${THREAD_ID}/summary`);
    expect(res.status).toBe(500);
    expect(db.threadSummary.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) }),
    );
    expect(mockRecordMeterUsage).not.toHaveBeenCalled();
  });

  it("marks the row FAILED and does not meter when the LLM call throws", async () => {
    mockGenerateThreadSummary.mockRejectedValue(new Error("boom"));
    const res = await post(`/workspaces/${WS_ID}/email-threads/${THREAD_ID}/summary`);
    expect(res.status).toBe(500);
    expect(mockRecordMeterUsage).not.toHaveBeenCalled();
  });

  it("returns 503 when no AI provider is configured", async () => {
    mockCreateAIProvider.mockImplementation(() => {
      throw new Error("no key");
    });
    const res = await post(`/workspaces/${WS_ID}/email-threads/${THREAD_ID}/summary`);
    expect(res.status).toBe(503);
    expect(db.threadSummary.upsert).not.toHaveBeenCalled();
  });

  // ── Quota ───────────────────────────────────────────────────────────────────

  it("returns 429 with quota details at the monthly limit", async () => {
    vi.mocked(db.inboxUsageMeter.findUnique).mockResolvedValue({ used: FREE_LIMIT } as never);
    const res = await post(`/workspaces/${WS_ID}/email-threads/${THREAD_ID}/summary`);
    expect(res.status).toBe(429);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toMatch(/quota exceeded/i);
    expect(body.used).toBe(FREE_LIMIT);
    expect(body.limit).toBe(FREE_LIMIT);
    expect(typeof body.resetsAt).toBe("string");
    expect(mockGenerateThreadSummary).not.toHaveBeenCalled();
    expect(db.threadSummary.upsert).not.toHaveBeenCalled();
  });

  it("uses the pooled inbox plan ceiling (PRO allows more than FREE)", async () => {
    mockResolveInboxQuota.mockResolvedValue({
      inboxKey: "ben@gmail.com",
      windowStart: new Date(Date.UTC(2026, 6, 1)),
      plan: "PRO",
      used: FREE_LIMIT + 1,
    });
    vi.mocked(db.inboxUsageMeter.findUnique).mockResolvedValue({ used: FREE_LIMIT + 1 } as never);
    const res = await post(`/workspaces/${WS_ID}/email-threads/${THREAD_ID}/summary`);
    expect(res.status).toBe(201);
  });

  it("still records usage when enforcement is off", async () => {
    mockBilling.enforceSummaryQuota = false;
    vi.mocked(db.inboxUsageMeter.findUnique).mockResolvedValue({ used: FREE_LIMIT } as never);
    const res = await post(`/workspaces/${WS_ID}/email-threads/${THREAD_ID}/summary`);
    expect(res.status).toBe(201);
    expect(mockRecordMeterUsage).toHaveBeenCalledOnce();
  });

  it("does not meter when there is no connected inbox (mock/dev path)", async () => {
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue(null as never);
    const res = await post(`/workspaces/${WS_ID}/email-threads/${THREAD_ID}/summary`);
    expect(res.status).toBe(201);
    expect(mockResolveInboxQuota).not.toHaveBeenCalled();
    expect(mockRecordMeterUsage).not.toHaveBeenCalled();
  });
});

// ─── Native-injection route (resolve by provider thread id) ────────────────────

describe("POST /workspaces/:workspaceId/provider-threads/:providerThreadId/summary", () => {
  it("resolves the thread across the workspace's email accounts and generates", async () => {
    vi.mocked(db.emailThread.findFirst)
      .mockResolvedValueOnce({ id: THREAD_ID } as never)
      .mockResolvedValueOnce(multiMessageThread() as never);
    const res = await post(`/workspaces/${WS_ID}/provider-threads/${PROVIDER_THREAD_ID}/summary`);
    expect(res.status).toBe(201);
    expect(db.emailThread.findFirst).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { emailAccountId: { in: ["acc-1"] }, providerThreadId: PROVIDER_THREAD_ID },
      }),
    );
  });

  it("404s when the provider thread belongs to another workspace", async () => {
    vi.mocked(db.emailThread.findFirst).mockResolvedValue(null as never);
    const res = await post(`/workspaces/${WS_ID}/provider-threads/${PROVIDER_THREAD_ID}/summary`);
    expect(res.status).toBe(404);
    expect(mockGenerateThreadSummary).not.toHaveBeenCalled();
  });

  it("404s when the workspace has no email accounts", async () => {
    vi.mocked(db.emailAccount.findMany).mockResolvedValue([] as never);
    const res = await post(`/workspaces/${WS_ID}/provider-threads/${PROVIDER_THREAD_ID}/summary`);
    expect(res.status).toBe(404);
    expect(db.emailThread.findFirst).not.toHaveBeenCalled();
  });

  it("decodes a URL-encoded provider thread id (Outlook conversationIds)", async () => {
    const raw = "AAQkAD/g+abc=";
    vi.mocked(db.emailThread.findFirst)
      .mockResolvedValueOnce({ id: THREAD_ID } as never)
      .mockResolvedValueOnce(multiMessageThread() as never);
    const res = await post(
      `/workspaces/${WS_ID}/provider-threads/${encodeURIComponent(raw)}/summary`,
    );
    expect(res.status).toBe(201);
    expect(db.emailThread.findFirst).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { emailAccountId: { in: ["acc-1"] }, providerThreadId: raw },
      }),
    );
  });
});

// ─── Quota read ────────────────────────────────────────────────────────────────

describe("GET /workspaces/:workspaceId/summary-quota", () => {
  it("returns used, limit, and resetsAt", async () => {
    mockResolveInboxQuota.mockResolvedValue({
      inboxKey: "ben@gmail.com",
      windowStart: new Date(Date.UTC(2026, 6, 1)),
      plan: "FREE",
      used: 7,
    });
    const res = await app.request(`/workspaces/${WS_ID}/summary-quota`, authed());
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.used).toBe(7);
    expect(body.limit).toBe(FREE_LIMIT);
    expect(typeof body.resetsAt).toBe("string");
  });

  it("reports zero usage with the FREE limit when no inbox is connected", async () => {
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue(null as never);
    const res = await app.request(`/workspaces/${WS_ID}/summary-quota`, authed());
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.used).toBe(0);
    expect(body.limit).toBe(FREE_LIMIT);
  });
});

describe("summary format", () => {
  it("persists and returns a bulleted summary", async () => {
    mockGenerateThreadSummary.mockResolvedValue({
      format: "BULLETS",
      text: null,
      bullets: ["Kabbalat Shabbat at 19:30", "Bring documents", "Sacramento 1227"],
    });
    const res = await post(`/workspaces/${WS_ID}/email-threads/${THREAD_ID}/summary`);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      kind: "summary",
      format: "BULLETS",
      bullets: ["Kabbalat Shabbat at 19:30", "Bring documents", "Sacramento 1227"],
    });
    expect(db.threadSummary.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          format: "BULLETS",
          summary: null,
          bullets: ["Kabbalat Shabbat at 19:30", "Bring documents", "Sacramento 1227"],
        }),
      }),
    );
  });

  it("serves a cached bulleted summary without regenerating", async () => {
    vi.mocked(db.threadSummary.findUnique).mockResolvedValue({
      status: "READY",
      summary: null,
      bullets: ["one", "two"],
      format: "BULLETS",
      promptVersion: SUMMARY_PROMPT_VERSION,
      locale: "en",
      messageSetSignature: SIGNATURE,
      generatedAt: new Date(Date.UTC(2026, 6, 2)),
      updatedAt: new Date(Date.UTC(2026, 6, 2)),
    } as never);
    const res = await post(`/workspaces/${WS_ID}/email-threads/${THREAD_ID}/summary`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ format: "BULLETS", bullets: ["one", "two"] });
    expect(mockGenerateThreadSummary).not.toHaveBeenCalled();
  });

  // A BULLETS row with an empty list carries no content — treating it as a hit
  // would render an empty card forever.
  it("regenerates a BULLETS row whose list is empty", async () => {
    vi.mocked(db.threadSummary.findUnique).mockResolvedValue({
      status: "READY",
      summary: null,
      bullets: [],
      format: "BULLETS",
      promptVersion: SUMMARY_PROMPT_VERSION,
      locale: "en",
      messageSetSignature: SIGNATURE,
      generatedAt: new Date(Date.UTC(2026, 6, 2)),
      updatedAt: new Date(Date.UTC(2026, 6, 2)),
    } as never);
    const res = await post(`/workspaces/${WS_ID}/email-threads/${THREAD_ID}/summary`);
    expect(res.status).toBe(201);
    expect(mockGenerateThreadSummary).toHaveBeenCalledOnce();
  });

  // Changing how summaries are written must not leave every cached row serving
  // output produced under the old rules.
  it("regenerates when the prompt version changed", async () => {
    vi.mocked(db.threadSummary.findUnique).mockResolvedValue({
      status: "READY",
      summary: "Written under the old prompt.",
      bullets: [],
      format: "PROSE",
      promptVersion: "1",
      locale: "en",
      messageSetSignature: SIGNATURE,
      generatedAt: new Date(Date.UTC(2026, 6, 2)),
      updatedAt: new Date(Date.UTC(2026, 6, 2)),
    } as never);
    const res = await post(`/workspaces/${WS_ID}/email-threads/${THREAD_ID}/summary`);
    expect(res.status).toBe(201);
    expect(mockGenerateThreadSummary).toHaveBeenCalledOnce();
  });

  it("stamps the current prompt version on the placeholder", async () => {
    await post(`/workspaces/${WS_ID}/email-threads/${THREAD_ID}/summary`);
    expect(db.threadSummary.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ promptVersion: SUMMARY_PROMPT_VERSION }),
      }),
    );
  });
});
