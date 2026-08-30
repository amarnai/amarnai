import { vi, describe, it, expect, beforeEach } from "vitest";
import { authed, TEST_USER_ID } from "./helpers.js";

// Covers generate-draft on a thread that has NOT been sorted. This used to be a
// 422 with a NOT_CLASSIFIED code, which made the native reply button dead on any
// unsorted thread — including threads deferred as QUOTA_BLOCKED, which are never
// classified until the month rolls over or the plan is upgraded. A classification
// is now an enhancement, not a precondition: the draft is generated from the
// thread's own messages and the triage context is simply absent.
//
// What these tests pin: the request reaches the LLM, every classification-derived
// field arrives as null (buildDraftPrompt drops the whole triage section on that),
// the Draft row is written with a null classificationId, and the generation is
// metered like any other — it is real LLM spend, so it must not be free.

const { mockRecordMeterUsage, mockResolveInboxQuota, mockGenerateDraft, mockCreateAIProvider } =
  vi.hoisted(() => ({
    mockRecordMeterUsage: vi.fn(),
    mockResolveInboxQuota: vi.fn(),
    mockGenerateDraft: vi.fn(),
    mockCreateAIProvider: vi.fn(),
  }));

vi.mock("@aziru/config", () => ({
  config: {
    redis: { url: "redis://localhost:6379" },
    billing: { enforceDraftQuota: true },
    internalApiSecret: "dev-internal-secret",
  },
}));

vi.mock("@aziru/db", () => ({
  Prisma: {},
  db: {
    emailThread: { findFirst: vi.fn() },
    emailClassification: { findFirst: vi.fn() },
    emailConnection: { findUnique: vi.fn() },
    workspace: { findUnique: vi.fn() },
    workspaceMember: { findUnique: vi.fn() },
    draft: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(),
  },
  getThreadSortUsage: vi.fn(),
  resolveInboxQuota: mockResolveInboxQuota,
  meterWindowStart: () => new Date(Date.UTC(2026, 6, 1)),
  recordMeterUsage: mockRecordMeterUsage,
}));

vi.mock("@aziru/ai", () => ({
  createAIProvider: mockCreateAIProvider,
  generateDraft: mockGenerateDraft,
  getDraftAIProviderConfig: () => ({ provider: "mock" }),
}));

vi.mock("@aziru/mail", () => ({
  createMailProvider: () => ({ getThreadSnapshot: vi.fn() }),
}));

import app from "../app.js";
import { db } from "@aziru/db";

const WS_ID = "ws-1";
const THREAD_ID = "thread-1";
const PLACEHOLDER_ID = "draft-1";
const WINDOW_START = new Date(Date.UTC(2026, 6, 1));

function threadWithMessages() {
  return {
    id: THREAD_ID,
    subject: "Kickoff",
    providerThreadId: "18f0abc123",
    messages: [
      {
        providerMessageId: "m1",
        subject: "Kickoff",
        senderEmail: "ana@acme.com",
        senderName: "Ana",
        bodyText: "Can you confirm Thursday?",
        receivedAt: new Date(Date.UTC(2026, 6, 1, 9)),
      },
    ],
  };
}

/** Captures what the route asked the transaction to create. */
let created: { data: Record<string, unknown> } | null = null;

/**
 * Drives the real transaction body with a tx stub, so the placeholder write and
 * the quota read are exercised rather than stubbed past.
 */
function runTransaction(cb: (tx: unknown) => Promise<unknown>) {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: WS_ID }]),
    draft: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
        created = args;
        return Promise.resolve({ id: PLACEHOLDER_ID });
      }),
    },
    inboxUsageMeter: { findUnique: vi.fn().mockResolvedValue({ used: 0 }) },
  };
  return cb(tx);
}

function generate() {
  return app.request(
    `/workspaces/${WS_ID}/email-threads/${THREAD_ID}/generate-draft`,
    authed({ method: "POST" })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  created = null;
  vi.mocked(db.workspaceMember.findUnique).mockResolvedValue({ userId: TEST_USER_ID } as never);
  vi.mocked(db.emailThread.findFirst).mockResolvedValue(threadWithMessages() as never);
  // The thread is synced but unsorted: no classification row exists.
  vi.mocked(db.emailClassification.findFirst).mockResolvedValue(null);
  // encryptedRefreshToken is null so the route keeps the DB bodies and never
  // reaches the mail provider; the address is what the draft meter is keyed on.
  vi.mocked(db.emailConnection.findUnique).mockResolvedValue({
    provider: "GMAIL",
    emailAddress: "user@acme.com",
    encryptedRefreshToken: null,
  } as never);
  vi.mocked(db.workspace.findUnique).mockResolvedValue({ plan: "PRO" } as never);
  vi.mocked(db.draft.findFirst).mockResolvedValue(null);
  vi.mocked(db.draft.update).mockResolvedValue({
    id: PLACEHOLDER_ID,
    subject: "Re: Kickoff",
    body: "Thursday works.",
    status: "PROPOSED",
    createdAt: new Date(Date.UTC(2026, 6, 2)),
  } as never);
  vi.mocked(db.$transaction).mockImplementation(runTransaction as never);
  mockResolveInboxQuota.mockResolvedValue({
    inboxKey: "inbox-1",
    plan: "PRO",
    windowStart: WINDOW_START,
    used: 0,
  });
  mockCreateAIProvider.mockReturnValue({ chat: vi.fn() });
  mockGenerateDraft.mockResolvedValue({ subject: "Re: Kickoff", body: "Thursday works." });
});

describe("POST generate-draft on an unclassified thread", () => {
  it("generates the draft instead of refusing", async () => {
    const res = await generate();
    expect(res.status).toBe(201);

    const body = (await res.json()) as { draft?: { body?: string } };
    expect(body.draft?.body).toBe("Thursday works.");
  });

  it("reaches the LLM with every triage field null", async () => {
    await generate();

    expect(mockGenerateDraft).toHaveBeenCalledTimes(1);
    const context = mockGenerateDraft.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(context).toMatchObject({
      requiredAction: null,
      suggestedNextStep: null,
      explanation: null,
      finalNodeName: null,
      draftInstructions: null,
      // Independent of the classification: it comes from the connection, and the
      // model still needs to know who it is writing as.
      senderEmail: "user@acme.com",
    });
  });

  it("still sends the thread's own messages, which carry the actual content", async () => {
    await generate();

    const messages = mockGenerateDraft.mock.calls[0]?.[1] as Array<Record<string, unknown>>;
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ senderEmail: "ana@acme.com" });
    // The internal id is split off before the AI layer, classified or not.
    expect(messages[0]).not.toHaveProperty("providerMessageId");
  });

  it("writes the Draft row with a null classificationId", async () => {
    await generate();

    expect(created?.data).toMatchObject({
      emailThreadId: THREAD_ID,
      workspaceId: WS_ID,
      classificationId: null,
      status: "GENERATING",
    });
  });

  it("meters the generation: unsorted is not a discount", async () => {
    await generate();

    expect(mockRecordMeterUsage).toHaveBeenCalledWith({
      inboxKey: "inbox-1",
      kind: "DRAFT",
      windowStart: WINDOW_START,
      delta: 1,
    });
  });

  it("still enforces the draft quota", async () => {
    vi.mocked(db.$transaction).mockImplementation(((cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        $queryRaw: vi.fn().mockResolvedValue([{ id: WS_ID }]),
        draft: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn() },
        inboxUsageMeter: { findUnique: vi.fn().mockResolvedValue({ used: 9_999 }) },
      };
      return cb(tx);
    }) as never);

    const res = await generate();
    expect(res.status).toBe(429);
    expect(mockGenerateDraft).not.toHaveBeenCalled();
    expect(mockRecordMeterUsage).not.toHaveBeenCalled();
  });

  it("still rejects a thread with no messages", async () => {
    vi.mocked(db.emailThread.findFirst).mockResolvedValue({
      ...threadWithMessages(),
      messages: [],
    } as never);

    const res = await generate();
    expect(res.status).toBe(422);
    expect(mockCreateAIProvider).not.toHaveBeenCalled();
  });

  it("charges nothing when the LLM fails, so a retry is free", async () => {
    mockGenerateDraft.mockResolvedValue(null);

    const res = await generate();
    expect(res.status).toBe(500);
    expect(mockRecordMeterUsage).not.toHaveBeenCalled();
    expect(db.draft.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: PLACEHOLDER_ID },
        data: expect.objectContaining({ status: "FAILED" }),
      })
    );
  });
});
