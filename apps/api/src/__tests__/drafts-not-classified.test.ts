import { vi, describe, it, expect, beforeEach } from "vitest";
import { authed, TEST_USER_ID } from "./helpers.js";

// Covers the unsorted-thread rejection on generate-draft. The `code` field is
// the contract the native Gmail/Outlook reply button depends on: it renders its
// own short label and cannot show a server sentence, so it branches on the code
// rather than on the prose. Also pins that this path is free — a user who clicks
// draft on a thread that has not been sorted yet must not be charged for it.

const { mockRecordMeterUsage, mockResolveInboxQuota, mockGenerateDraft, mockCreateAIProvider } =
  vi.hoisted(() => ({
    mockRecordMeterUsage: vi.fn(),
    mockResolveInboxQuota: vi.fn(),
    mockGenerateDraft: vi.fn(),
    mockCreateAIProvider: vi.fn(),
  }));

vi.mock("@amarnai/config", () => ({
  config: {
    redis: { url: "redis://localhost:6379" },
    billing: { enforceDraftQuota: true },
    internalApiSecret: "dev-internal-secret",
  },
}));

vi.mock("@amarnai/db", () => ({
  Prisma: {},
  db: {
    emailThread: { findFirst: vi.fn() },
    emailClassification: { findFirst: vi.fn() },
    emailConnection: { findUnique: vi.fn() },
    workspaceMember: { findUnique: vi.fn() },
    draft: { findFirst: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn(),
  },
  getThreadSortUsage: vi.fn(),
  resolveInboxQuota: mockResolveInboxQuota,
  meterWindowStart: () => new Date(Date.UTC(2026, 6, 1)),
  recordMeterUsage: mockRecordMeterUsage,
}));

vi.mock("@amarnai/ai", () => ({
  createAIProvider: mockCreateAIProvider,
  generateDraft: mockGenerateDraft,
  getDraftAIProviderConfig: () => ({ provider: "mock" }),
}));

vi.mock("@amarnai/mail", () => ({
  createMailProvider: () => ({ getThreadSnapshot: vi.fn() }),
}));

import app from "../app.js";
import { db } from "@amarnai/db";

const WS_ID = "ws-1";
const THREAD_ID = "thread-1";

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

function generate() {
  return app.request(
    `/workspaces/${WS_ID}/email-threads/${THREAD_ID}/generate-draft`,
    authed({ method: "POST" })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.workspaceMember.findUnique).mockResolvedValue({ userId: TEST_USER_ID } as never);
  vi.mocked(db.emailThread.findFirst).mockResolvedValue(threadWithMessages() as never);
  vi.mocked(db.emailClassification.findFirst).mockResolvedValue(null);
});

describe("POST generate-draft on an unclassified thread", () => {
  it("rejects with 422 and the NOT_CLASSIFIED code alongside the prose error", async () => {
    const res = await generate();
    expect(res.status).toBe(422);

    const body = (await res.json()) as { code?: string; error?: string };
    expect(body.code).toBe("NOT_CLASSIFIED");
    expect(body.error).toMatch(/not been classified/i);
  });

  it("records no meter usage, so retrying after the sort lands is free", async () => {
    await generate();
    expect(mockRecordMeterUsage).not.toHaveBeenCalled();
  });

  it("never reaches the LLM", async () => {
    await generate();
    expect(mockGenerateDraft).not.toHaveBeenCalled();
    expect(mockCreateAIProvider).not.toHaveBeenCalled();
  });

  it("does not tag the unrelated empty-thread 422 with the code", async () => {
    // Same status, different cause: the discriminator must not be a blanket
    // stand-in for "422 from this route".
    vi.mocked(db.emailThread.findFirst).mockResolvedValue({
      ...threadWithMessages(),
      messages: [],
    } as never);

    const res = await generate();
    expect(res.status).toBe(422);
    expect((await res.json()) as { code?: string }).not.toHaveProperty("code");
  });
});
