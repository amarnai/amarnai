import { vi, describe, it, expect, beforeEach } from "vitest";
import { authed, TEST_USER_ID } from "./helpers.js";

// The provider-id generate-draft route: the one the native Gmail/Outlook reply
// button calls. What matters here is the wrapper, not the generation itself
// (covered by drafts-unclassified.test.ts): the workspace kill-switch, the
// EWS↔Graph id normalization, and cross-workspace isolation.

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
    emailAccount: { findMany: vi.fn() },
    emailClassification: { findFirst: vi.fn() },
    emailConnection: { findUnique: vi.fn() },
    gmailSyncSettings: { findUnique: vi.fn() },
    workspace: { findUnique: vi.fn() },
    workspaceMember: { findUnique: vi.fn() },
    draft: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
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
const ACCOUNT_ID = "acct-1";
const THREAD_ID = "thread-1";

/** Graph stores the URL-safe alphabet; OWA's DOM hands us the EWS one. */
const STORED_CONVERSATION_ID = "AAQkAD_bc-de_fg-hi";
const EWS_CONVERSATION_ID = "AAQkAD+bc/de+fg/hi";

function post(providerThreadId: string) {
  return app.request(
    `/workspaces/${WS_ID}/provider-threads/${encodeURIComponent(providerThreadId)}/generate-draft`,
    authed({ method: "POST" })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.workspaceMember.findUnique).mockResolvedValue({ userId: TEST_USER_ID } as never);
  vi.mocked(db.gmailSyncSettings.findUnique).mockResolvedValue(null);
  vi.mocked(db.emailAccount.findMany).mockResolvedValue([{ id: ACCOUNT_ID }] as never);
  // Two lookups go through emailThread.findFirst: resolution (reads only `id`)
  // and the generation's own thread load (reads the messages). One fixture
  // satisfies both.
  vi.mocked(db.emailThread.findFirst).mockResolvedValue({
    id: THREAD_ID,
    subject: "Kickoff",
    providerThreadId: STORED_CONVERSATION_ID,
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
  } as never);
  vi.mocked(db.emailClassification.findFirst).mockResolvedValue(null);
  // No connection: the draft meter is keyed on the mailbox address, so this path
  // skips quota and metering. Irrelevant to the wrapper, exercised in
  // drafts-unclassified.test.ts.
  vi.mocked(db.emailConnection.findUnique).mockResolvedValue(null);
  vi.mocked(db.workspace.findUnique).mockResolvedValue({ plan: "PRO" } as never);
  vi.mocked(db.draft.findFirst).mockResolvedValue(null);
  vi.mocked(db.draft.update).mockResolvedValue({
    id: "draft-1",
    subject: "Re: Kickoff",
    body: "Thursday works.",
    status: "PROPOSED",
    createdAt: new Date(Date.UTC(2026, 6, 2)),
  } as never);
  vi.mocked(db.$transaction).mockImplementation((async (cb: (tx: unknown) => Promise<unknown>) =>
    cb({
      $queryRaw: vi.fn().mockResolvedValue([{ id: WS_ID }]),
      draft: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: "draft-1" }),
      },
      inboxUsageMeter: { findUnique: vi.fn().mockResolvedValue({ used: 0 }) },
    })) as never);
  mockCreateAIProvider.mockReturnValue({ chat: vi.fn() });
  mockGenerateDraft.mockResolvedValue({ subject: "Re: Kickoff", body: "Thursday works." });
});

describe("POST provider-threads/:id/generate-draft", () => {
  it("resolves the thread and hands off to the generation path", async () => {
    const res = await post(STORED_CONVERSATION_ID);
    // 201 = it got past resolution and generated. Anything earlier (400/403/404)
    // means the wrapper failed. The thread is unsorted, which is no longer a
    // refusal: the draft is written without triage context.
    expect(res.status).toBe(201);
    expect(mockGenerateDraft).toHaveBeenCalledTimes(1);
  });

  it("normalizes an EWS-flavored conversation id onto the stored alphabet", async () => {
    await post(EWS_CONVERSATION_ID);

    const lookup = vi.mocked(db.emailThread.findFirst).mock.calls[0]?.[0] as {
      where: { providerThreadId: string };
    };
    expect(lookup.where.providerThreadId).toBe(STORED_CONVERSATION_ID);
  });

  it("404s a thread that was never synced, without touching the LLM", async () => {
    vi.mocked(db.emailThread.findFirst).mockResolvedValue(null);

    const res = await post("never-synced");
    expect(res.status).toBe(404);
    expect(mockCreateAIProvider).not.toHaveBeenCalled();
  });

  // Resolution is a single indexed lookup on (workspaceId, providerThreadId).
  // The workspace filter is the tenancy boundary: without it, any member of any
  // workspace could name another tenant's conversation id and get a draft.
  it("scopes resolution to the requesting workspace", async () => {
    await post(STORED_CONVERSATION_ID);

    const lookup = vi.mocked(db.emailThread.findFirst).mock.calls[0]?.[0] as {
      where: { workspaceId: string; providerThreadId: string };
    };
    expect(lookup.where).toMatchObject({
      workspaceId: WS_ID,
      providerThreadId: STORED_CONVERSATION_ID,
    });
  });

  describe("workspace kill-switch", () => {
    it("refuses with 403 injectionDisabled when the reply button is turned off", async () => {
      vi.mocked(db.gmailSyncSettings.findUnique).mockResolvedValue({
        threadSummaryInjectionEnabled: true,
        replyButtonInjectionEnabled: false,
      } as never);

      const res = await post(STORED_CONVERSATION_ID);
      expect(res.status).toBe(403);
      expect((await res.json()) as { injectionDisabled?: boolean }).toMatchObject({
        injectionDisabled: true,
      });
      // Refused before any thread lookup: the kill-switch is the first gate.
      expect(db.emailAccount.findMany).not.toHaveBeenCalled();
    });

    it("is independent of the thread-summary toggle", async () => {
      vi.mocked(db.gmailSyncSettings.findUnique).mockResolvedValue({
        threadSummaryInjectionEnabled: false,
        replyButtonInjectionEnabled: true,
      } as never);

      const res = await post(STORED_CONVERSATION_ID);
      expect(res.status).not.toBe(403);
    });

    it("treats a missing settings row as enabled", async () => {
      vi.mocked(db.gmailSyncSettings.findUnique).mockResolvedValue(null);

      const res = await post(STORED_CONVERSATION_ID);
      expect(res.status).not.toBe(403);
    });
  });
});
