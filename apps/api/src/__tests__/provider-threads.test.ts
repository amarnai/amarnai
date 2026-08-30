import { vi, describe, it, expect, beforeEach } from "vitest";
import { authed, TEST_USER_ID } from "./helpers.js";

// The GET provider-thread route: how the panel injected into Gmail/Outlook gets
// the thread it is looking at. What matters here is the wrapper — the workspace
// kill switch, the EWS↔Graph id normalization, workspace isolation, and the
// "never synced" 404 — not the serializer, which is the same one
// /email-threads/:threadId has always used.

vi.mock("@aziru/config", () => ({
  config: {
    redis: { url: "redis://localhost:6379" },
    billing: {},
    internalApiSecret: "dev-internal-secret",
    mail: { labelWritebackEnabled: false },
  },
}));

vi.mock("@aziru/db", () => ({
  Prisma: {},
  db: {
    emailThread: { findFirst: vi.fn() },
    emailMessage: { findFirst: vi.fn() },
    emailAccount: { findMany: vi.fn() },
    gmailSyncSettings: { findUnique: vi.fn() },
    workspaceMember: { findUnique: vi.fn() },
    threadComment: { count: vi.fn() },
    threadCommentRead: { findUnique: vi.fn() },
  },
}));

vi.mock("@aziru/mail", () => ({
  createMailProvider: () => ({ getThreadSnapshot: vi.fn() }),
  providerHasWritebackScope: () => false,
}));

import app from "../app.js";
import { db } from "@aziru/db";

const WS_ID = "ws-1";
const THREAD_ID = "thread-1";
const ACCOUNT_ID = "acct-1";

/** Graph stores the URL-safe alphabet; OWA's DOM hands us the EWS one. */
const STORED_CONVERSATION_ID = "AAQkAD_bc-de_fg-hi";
const EWS_CONVERSATION_ID = "AAQkAD+bc/de+fg/hi";

// A message store id, as OWA's deeplink read view carries it: the `ItemID` query
// param holds the EWS flavor, the path segment the URL-safe one we store.
const STORED_MESSAGE_ID = "AAkALg_HYQDEapm-EWg0AFt";
const EWS_MESSAGE_ID = "AAkALg+HYQDEapm/EWg0AFt";

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

function get(providerThreadId: string, workspaceId = WS_ID, query = "") {
  return app.request(
    `/workspaces/${workspaceId}/provider-threads/${encodeURIComponent(providerThreadId)}${query}`,
    authed(),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.workspaceMember.findUnique).mockResolvedValue({ userId: TEST_USER_ID } as never);
  vi.mocked(db.gmailSyncSettings.findUnique).mockResolvedValue(null as never);
  vi.mocked(db.emailThread.findFirst).mockResolvedValue(threadRow() as never);
  vi.mocked(db.emailAccount.findMany).mockResolvedValue([{ id: ACCOUNT_ID }] as never);
  vi.mocked(db.emailMessage.findFirst).mockResolvedValue({
    emailThreadId: THREAD_ID,
  } as never);
});

describe("GET /workspaces/:workspaceId/provider-threads/:providerThreadId", () => {
  it("returns the thread detail for a synced provider thread id", async () => {
    const res = await get(STORED_CONVERSATION_ID);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["id"]).toBe(THREAD_ID);
    expect(body["latestClassification"]).toMatchObject({ finalNode: { name: "Clients" } });
    expect(body["filedNode"]).toMatchObject({ name: "Clients" });
  });

  // A re-sort that ends in needs-review records no destination, and the thread
  // keeps the filing (and the mailbox label) the previous run gave it. Reporting
  // it as unsorted would contradict the label the reader can see on the very
  // same conversation, so the folder survives the newer, node-less run.
  it("still names the folder when the newest classification chose none", async () => {
    vi.mocked(db.emailThread.findFirst).mockResolvedValue({
      ...threadRow(),
      classifications: [
        { id: "c2", finalNode: null, needsHumanReview: true },
        { id: "c1", finalNode: { id: "n1", name: "Clients" } },
      ],
    } as never);
    const body = (await (await get(STORED_CONVERSATION_ID)).json()) as Record<string, unknown>;
    expect(body["latestClassification"]).toMatchObject({ id: "c2", finalNode: null });
    expect(body["filedNode"]).toMatchObject({ id: "n1", name: "Clients" });
  });

  it("reports no folder for a thread no run has ever routed", async () => {
    vi.mocked(db.emailThread.findFirst).mockResolvedValue({
      ...threadRow(),
      classifications: [{ id: "c1", finalNode: null }],
    } as never);
    const body = (await (await get(STORED_CONVERSATION_ID)).json()) as Record<string, unknown>;
    expect(body["filedNode"]).toBeNull();
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

// OWA's standalone deeplink read view (/mail/deeplink/read/<id>?ItemID=<id>) is an
// ITEM view: it renders one message, carries no data-convid anywhere, and the only
// id it can offer is the message's own. `ref=message` is how a surface says so.
describe("GET provider-threads with ref=message", () => {
  const messageRef = (id: string, workspaceId = WS_ID) =>
    get(id, workspaceId, "?ref=message");

  it("resolves the thread that contains the message", async () => {
    const res = await messageRef(STORED_MESSAGE_ID);
    expect(res.status).toBe(200);
    expect(((await res.json()) as Record<string, unknown>)["id"]).toBe(THREAD_ID);
    // Resolution went through the message, not the conversation lookup.
    expect(db.emailMessage.findFirst).toHaveBeenCalled();
  });

  // The same alphabet fix the conversation path gets: OWA hands out the EWS
  // flavor and we store Graph's, for message ids exactly as for thread ids.
  it("normalizes an EWS-flavored message id onto the stored alphabet", async () => {
    await messageRef(EWS_MESSAGE_ID);
    expect(vi.mocked(db.emailMessage.findFirst).mock.calls[0]?.[0]).toMatchObject({
      where: { providerMessageId: STORED_MESSAGE_ID },
    });
  });

  // Load-bearing for two reasons, both documented on resolveProviderMessageId:
  // the only index on this column leads with emailAccountId, so a workspaceId
  // query degrades to a full scan of every message row; and providerMessageId is
  // unique per ACCOUNT, so an unscoped lookup could answer with another tenant's
  // thread. Live data has the same message id under three accounts.
  it("scopes the message lookup to the workspace's own accounts", async () => {
    await messageRef(STORED_MESSAGE_ID);
    expect(vi.mocked(db.emailAccount.findMany).mock.calls[0]?.[0]).toMatchObject({
      where: { workspaceId: WS_ID },
    });
    expect(vi.mocked(db.emailMessage.findFirst).mock.calls[0]?.[0]).toMatchObject({
      where: { emailAccountId: { in: [ACCOUNT_ID] } },
    });
  });

  it("404s without touching messages when the workspace has no accounts", async () => {
    vi.mocked(db.emailAccount.findMany).mockResolvedValue([] as never);
    expect((await messageRef(STORED_MESSAGE_ID)).status).toBe(404);
    expect(db.emailMessage.findFirst).not.toHaveBeenCalled();
  });

  it("404s a message that was never synced", async () => {
    vi.mocked(db.emailMessage.findFirst).mockResolvedValue(null as never);
    expect((await messageRef("never-synced")).status).toBe(404);
  });

  // Explicit, never inferred: both id flavors are 68-char base64 for a consumer
  // mailbox, so a typo'd or unknown ref must fail rather than quietly resolve as
  // the other kind.
  it("400s an unknown ref kind without querying anything", async () => {
    const res = await get(STORED_MESSAGE_ID, WS_ID, "?ref=conversation");
    expect(res.status).toBe(400);
    expect(db.emailMessage.findFirst).not.toHaveBeenCalled();
    expect(db.emailThread.findFirst).not.toHaveBeenCalled();
  });

  it("treats an absent ref as the conversation lookup", async () => {
    await get(STORED_CONVERSATION_ID);
    expect(db.emailMessage.findFirst).not.toHaveBeenCalled();
    expect(vi.mocked(db.emailThread.findFirst).mock.calls[0]?.[0]).toMatchObject({
      where: { providerThreadId: STORED_CONVERSATION_ID },
    });
  });

  it("still honours the panel kill switch", async () => {
    vi.mocked(db.gmailSyncSettings.findUnique).mockResolvedValue({
      threadSummaryInjectionEnabled: true,
      replyButtonInjectionEnabled: true,
      injectedPanelEnabled: false,
    } as never);
    const res = await messageRef(STORED_MESSAGE_ID);
    expect(res.status).toBe(403);
    expect(db.emailMessage.findFirst).not.toHaveBeenCalled();
  });

  it("404s a workspace the caller is not a member of", async () => {
    vi.mocked(db.workspaceMember.findUnique).mockResolvedValue(null as never);
    expect((await messageRef(STORED_MESSAGE_ID)).status).toBe(404);
    expect(db.emailMessage.findFirst).not.toHaveBeenCalled();
  });
});

// The comments badge for the in-page bubble on the injected summary card. Only
// the two counts ever leave this route — comment content stays in the panel —
// and it wears the same injected-panel kill switch as the routes it serves.
describe("GET provider-threads .../comments/meta", () => {
  const meta = (id: string, query = "") =>
    app.request(
      `/workspaces/${WS_ID}/provider-threads/${encodeURIComponent(id)}/comments/meta${query}`,
      authed(),
    );

  beforeEach(() => {
    vi.mocked(db.threadCommentRead.findUnique).mockResolvedValue(null as never);
    vi.mocked(db.threadComment.count).mockResolvedValue(0 as never);
  });

  it("returns the total and the caller's unread count", async () => {
    vi.mocked(db.threadCommentRead.findUnique).mockResolvedValue({
      lastReadAt: new Date("2026-08-04T09:00:00Z"),
    } as never);
    vi.mocked(db.threadComment.count).mockImplementation((async (args: {
      where: { authorUserId?: { not: string } };
    }) => (args.where.authorUserId ? 2 : 5)) as never);

    const res = await meta(STORED_CONVERSATION_ID);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ total: 5, unread: 2 });
    // Unread excludes the caller's own comments and respects the read marker.
    expect(db.threadComment.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          authorUserId: { not: TEST_USER_ID },
          createdAt: { gt: new Date("2026-08-04T09:00:00Z") },
        }),
      }),
    );
  });

  it("resolves the deeplink read view's message id to its thread", async () => {
    const res = await meta(STORED_MESSAGE_ID, "?ref=message");
    expect(res.status).toBe(200);
    expect(db.emailMessage.findFirst).toHaveBeenCalled();
  });

  it("404s a thread that was never synced (no bubble, not an error)", async () => {
    vi.mocked(db.emailThread.findFirst).mockResolvedValue(null as never);
    expect((await meta("never-synced")).status).toBe(404);
    expect(db.threadComment.count).not.toHaveBeenCalled();
  });

  it("403s with injectionDisabled when the workspace has the panel switched off", async () => {
    vi.mocked(db.gmailSyncSettings.findUnique).mockResolvedValue({
      threadSummaryInjectionEnabled: true,
      replyButtonInjectionEnabled: true,
      injectedPanelEnabled: false,
    } as never);
    const res = await meta(STORED_CONVERSATION_ID);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ injectionDisabled: true });
    expect(db.threadComment.count).not.toHaveBeenCalled();
  });

  it("404s a workspace the caller is not a member of", async () => {
    vi.mocked(db.workspaceMember.findUnique).mockResolvedValue(null as never);
    expect((await meta(STORED_CONVERSATION_ID)).status).toBe(404);
    expect(db.threadComment.count).not.toHaveBeenCalled();
  });
});
