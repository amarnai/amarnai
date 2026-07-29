import { vi, describe, it, expect, beforeEach } from "vitest";
import { authed, TEST_USER_ID } from "./helpers.js";

// The GET provider-thread route: how the panel injected into Gmail/Outlook gets
// the thread it is looking at. What matters here is the wrapper — the workspace
// kill switch, the EWS↔Graph id normalization, workspace isolation, and the
// "never synced" 404 — not the serializer, which is the same one
// /email-threads/:threadId has always used.

vi.mock("@amarnai/config", () => ({
  config: {
    redis: { url: "redis://localhost:6379" },
    billing: {},
    internalApiSecret: "dev-internal-secret",
    mail: { labelWritebackEnabled: false },
  },
}));

vi.mock("@amarnai/db", () => ({
  Prisma: {},
  db: {
    emailThread: { findFirst: vi.fn() },
    gmailSyncSettings: { findUnique: vi.fn() },
    workspaceMember: { findUnique: vi.fn() },
  },
}));

vi.mock("@amarnai/mail", () => ({
  createMailProvider: () => ({ getThreadSnapshot: vi.fn() }),
  providerHasWritebackScope: () => false,
}));

import app from "../app.js";
import { db } from "@amarnai/db";

const WS_ID = "ws-1";
const THREAD_ID = "thread-1";

/** Graph stores the URL-safe alphabet; OWA's DOM hands us the EWS one. */
const STORED_CONVERSATION_ID = "AAQkAD_bc-de_fg-hi";
const EWS_CONVERSATION_ID = "AAQkAD+bc/de+fg/hi";

function threadRow() {
  return {
    id: THREAD_ID,
    subject: "Kickoff",
    provider: "OUTLOOK",
    providerThreadId: STORED_CONVERSATION_ID,
    webLink: "https://outlook.office.com/mail/id/x",
    latestMessageAt: new Date("2026-07-29T10:00:00Z"),
    messageCount: 2,
    triageStatus: "SORTED",
    classifyingAt: null,
    createdAt: new Date("2026-07-29T09:00:00Z"),
    updatedAt: new Date("2026-07-29T10:00:00Z"),
    isImportant: false,
    resolvedByUserId: null,
    resolvedAt: null,
    resolvedByUser: null,
    assignedToUserId: null,
    assignedAt: null,
    assignedToUser: null,
    messages: [
      {
        id: "m1",
        senderEmail: "ana@acme.com",
        senderName: "Ana",
        subject: "Kickoff",
        snippet: "Can you confirm Thursday?",
        bodyText: "Can you confirm Thursday? [cid:logo]",
        receivedAt: new Date("2026-07-29T09:00:00Z"),
        hasAttachments: false,
        attachments: [],
        toEmails: [],
      },
    ],
    classifications: [{ id: "c1", finalNode: { id: "n1", name: "Clients" } }],
    tags: [],
    drafts: [],
  };
}

function get(providerThreadId: string, workspaceId = WS_ID) {
  return app.request(
    `/workspaces/${workspaceId}/provider-threads/${encodeURIComponent(providerThreadId)}`,
    authed(),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.workspaceMember.findUnique).mockResolvedValue({ userId: TEST_USER_ID } as never);
  vi.mocked(db.gmailSyncSettings.findUnique).mockResolvedValue(null as never);
  vi.mocked(db.emailThread.findFirst).mockResolvedValue(threadRow() as never);
});

describe("GET /workspaces/:workspaceId/provider-threads/:providerThreadId", () => {
  it("returns the thread detail for a synced provider thread id", async () => {
    const res = await get(STORED_CONVERSATION_ID);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["id"]).toBe(THREAD_ID);
    expect(body["latestClassification"]).toMatchObject({ finalNode: { name: "Clients" } });
  });

  // The same serializer as /email-threads/:threadId, so the panel and the web
  // app can share every component that renders a thread. Pinned here because a
  // divergence would only show up as a subtly-wrong panel.
  it("serializes exactly like the internal-id detail route", async () => {
    const [byProviderId, byInternalId] = await Promise.all([
      get(STORED_CONVERSATION_ID),
      app.request(`/workspaces/${WS_ID}/email-threads/${THREAD_ID}`, authed()),
    ]);
    expect(await byProviderId.json()).toEqual(await byInternalId.json());
  });

  // OWA's DOM carries the EWS base64 alphabet; we store Graph's. Normalizing in
  // one shared place is what keeps the summary, the draft and the panel from
  // disagreeing about whether a thread exists.
  it("resolves an EWS-flavored conversation id against the stored Graph one", async () => {
    const res = await get(EWS_CONVERSATION_ID);
    expect(res.status).toBe(200);
    expect(vi.mocked(db.emailThread.findFirst).mock.calls[0]?.[0]).toMatchObject({
      where: { workspaceId: WS_ID, providerThreadId: STORED_CONVERSATION_ID },
    });
  });

  // Not an error: the mail client is showing a thread Amarnai has not synced.
  // The panel renders "not synced yet" for this, so it must stay distinguishable
  // from a failure.
  it("404s a thread that was never synced", async () => {
    vi.mocked(db.emailThread.findFirst).mockResolvedValue(null as never);
    const res = await get("never-synced");
    expect(res.status).toBe(404);
  });

  it("scopes the lookup to the workspace in the URL", async () => {
    await get(STORED_CONVERSATION_ID, "ws-other");
    expect(vi.mocked(db.emailThread.findFirst).mock.calls[0]?.[0]).toMatchObject({
      where: { workspaceId: "ws-other" },
    });
  });

  it("404s a workspace the caller is not a member of, without querying threads", async () => {
    vi.mocked(db.workspaceMember.findUnique).mockResolvedValue(null as never);
    const res = await get(STORED_CONVERSATION_ID);
    expect(res.status).toBe(404);
    expect(db.emailThread.findFirst).not.toHaveBeenCalled();
  });

  // The extension is the half we do not control, so the kill switch is enforced
  // here and not in the content script: an old build must stop the moment the
  // workspace turns the panel off.
  it("403s with injectionDisabled when the workspace has the panel switched off", async () => {
    vi.mocked(db.gmailSyncSettings.findUnique).mockResolvedValue({
      threadSummaryInjectionEnabled: true,
      replyButtonInjectionEnabled: true,
      injectedPanelEnabled: false,
    } as never);
    const res = await get(STORED_CONVERSATION_ID);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ injectionDisabled: true });
    expect(db.emailThread.findFirst).not.toHaveBeenCalled();
  });

  // The panel toggle is independent of the other two injected surfaces.
  it("serves the thread when only the other injection toggles are off", async () => {
    vi.mocked(db.gmailSyncSettings.findUnique).mockResolvedValue({
      threadSummaryInjectionEnabled: false,
      replyButtonInjectionEnabled: false,
      injectedPanelEnabled: true,
    } as never);
    expect((await get(STORED_CONVERSATION_ID)).status).toBe(200);
  });

  it("treats a workspace with no settings row as fully enabled", async () => {
    vi.mocked(db.gmailSyncSettings.findUnique).mockResolvedValue(null as never);
    expect((await get(STORED_CONVERSATION_ID)).status).toBe(200);
  });
});
