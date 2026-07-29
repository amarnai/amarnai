import { vi, describe, it, expect, beforeEach } from "vitest";
import { authed, TEST_USER_ID } from "./helpers.js";

// The queue the injected panel shows when no conversation is open. What matters
// here is what each section actually asks the database for — "assigned to me and
// not done" is a promise about someone's own workload, and getting the predicate
// wrong would show them another member's threads or ones they already closed —
// plus the kill switch, which this route has to enforce itself because it
// resolves no provider thread id.

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
    emailThread: { findMany: vi.fn(), count: vi.fn() },
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

function threadRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "t1",
    subject: "Kickoff",
    provider: "GMAIL",
    providerThreadId: "18f0abc",
    webLink: null,
    latestMessageAt: new Date("2026-07-29T10:00:00Z"),
    resolvedByUserId: null,
    resolvedAt: null,
    resolvedByUser: null,
    messages: [{ senderEmail: "ada@example.com", senderName: "Ada Lovelace" }],
    ...overrides,
  };
}

function get(workspaceId = WS_ID) {
  return app.request(`/workspaces/${workspaceId}/panel-queue`, authed());
}

/** The three findMany calls, in the order the route issues them. */
function findManyWhere(index: number) {
  return (vi.mocked(db.emailThread.findMany).mock.calls[index]?.[0] as { where: unknown }).where;
}

function countWheres() {
  return vi.mocked(db.emailThread.count).mock.calls.map(
    (call) => (call[0] as { where: Record<string, unknown> }).where,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.workspaceMember.findUnique).mockResolvedValue({ userId: TEST_USER_ID } as never);
  vi.mocked(db.gmailSyncSettings.findUnique).mockResolvedValue(null as never);
  vi.mocked(db.emailThread.findMany).mockResolvedValue([threadRow()] as never);
  vi.mocked(db.emailThread.count).mockResolvedValue(1 as never);
});

describe("GET /workspaces/:workspaceId/panel-queue", () => {
  it("returns the three sections with their true counts", async () => {
    vi.mocked(db.emailThread.count)
      .mockResolvedValueOnce(3 as never) // assigned
      .mockResolvedValueOnce(12 as never) // needs review
      .mockResolvedValueOnce(2 as never) // drafts
      .mockResolvedValueOnce(9 as never) // pending
      .mockResolvedValueOnce(4 as never); // pending waiting

    const res = await get();
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, { count: number }> & {
      pendingCount: number;
      pendingWaitingCount: number;
    };

    expect(body["assignedToMe"]?.count).toBe(3);
    expect(body["needsReview"]?.count).toBe(12);
    expect(body["proposedDrafts"]?.count).toBe(2);
    expect(body.pendingCount).toBe(9);
    expect(body.pendingWaitingCount).toBe(4);
  });

  // The assigned section is one person's workload: another member's threads must
  // never appear in it, and neither must ones already marked done.
  it("scopes the assigned section to the caller, excluding done threads", async () => {
    await get();
    expect(findManyWhere(0)).toMatchObject({
      workspaceId: WS_ID,
      assignedToUserId: TEST_USER_ID,
      resolvedAt: null,
    });
  });

  it("filters needs-review by triage status", async () => {
    await get();
    expect(findManyWhere(1)).toMatchObject({
      workspaceId: WS_ID,
      triageStatus: "NEEDS_REVIEW",
    });
  });

  // PROPOSED is the awaiting-approval state; a GENERATING draft is still being
  // written and has nothing to approve yet.
  it("finds draft threads by a proposed draft, not a generating one", async () => {
    await get();
    expect(findManyWhere(2)).toMatchObject({
      workspaceId: WS_ID,
      drafts: { some: { status: "PROPOSED" } },
    });
  });

  // Only the assigned section is a to-do list. Needs review and drafts describe
  // what Amarnai thinks about a thread, which marking it done does not change.
  it("does not exclude done threads from the other two sections", async () => {
    await get();
    expect(findManyWhere(1)).not.toHaveProperty("resolvedAt");
    expect(findManyWhere(2)).not.toHaveProperty("resolvedAt");
  });

  it("counts sorting in flight as pending minus pending-waiting", async () => {
    await get();
    const wheres = countWheres();
    expect(wheres[3]).toMatchObject({ triageStatus: "PENDING" });
    expect(wheres[3]).not.toHaveProperty("classifyingAt");
    expect(wheres[4]).toMatchObject({ triageStatus: "PENDING", classifyingAt: null });
  });

  // A thread hidden from the web app's list must be hidden here too, or the
  // panel would surface spam the inbox itself refuses to show.
  it("applies the workspace's visibility filters to every section", async () => {
    vi.mocked(db.gmailSyncSettings.findUnique).mockResolvedValue({
      injectedPanelEnabled: true,
      includeSpam: false,
      includePromotions: false,
      blacklistedSenderEmails: ["spam@bad.com"],
    } as never);

    await get();

    const expected = {
      gmailIsTrash: false,
      gmailIsSpam: false,
      gmailIsPromotions: false,
      NOT: { messages: { some: { senderEmail: { in: ["spam@bad.com"] } } } },
    };
    for (const index of [0, 1, 2]) expect(findManyWhere(index)).toMatchObject(expected);
    for (const where of countWheres()) expect(where).toMatchObject(expected);
  });

  it("honours a workspace that opted into spam and promotions", async () => {
    vi.mocked(db.gmailSyncSettings.findUnique).mockResolvedValue({
      injectedPanelEnabled: true,
      includeSpam: true,
      includePromotions: true,
      blacklistedSenderEmails: [],
    } as never);

    await get();
    expect(findManyWhere(0)).not.toHaveProperty("gmailIsSpam");
    expect(findManyWhere(0)).not.toHaveProperty("gmailIsPromotions");
  });

  // Rows carry a sender and a subject and nothing else: the panel is a 300px
  // column, and the message bodies belong to the mail client.
  it("serializes a slim row with the latest sender and no message list", async () => {
    const res = await get();
    const body = (await res.json()) as {
      assignedToMe: { threads: Record<string, unknown>[] };
    };
    const row = body.assignedToMe.threads[0]!;

    expect(row).toMatchObject({
      id: "t1",
      subject: "Kickoff",
      providerThreadId: "18f0abc",
      senderName: "Ada Lovelace",
      senderEmail: "ada@example.com",
      doneMark: null,
    });
    expect(row).not.toHaveProperty("messages");
  });

  it("serializes the done mark in the same shape as the thread list", async () => {
    vi.mocked(db.emailThread.findMany).mockResolvedValue([
      threadRow({
        resolvedByUserId: "u2",
        resolvedAt: new Date("2026-07-29T11:00:00Z"),
        resolvedByUser: { id: "u2", email: "grace@example.com", name: "Grace" },
      }),
    ] as never);

    const body = (await (await get()).json()) as {
      assignedToMe: { threads: { doneMark: unknown }[] };
    };
    expect(body.assignedToMe.threads[0]?.doneMark).toEqual({
      userId: "u2",
      userEmail: "grace@example.com",
      userName: "Grace",
      resolvedAt: "2026-07-29T11:00:00.000Z",
    });
  });

  // The panel would otherwise never consult the flag on this screen: it resolves
  // no provider thread id, so the route that normally enforces it is never hit.
  it("403s with injectionDisabled when the workspace has the panel switched off", async () => {
    vi.mocked(db.gmailSyncSettings.findUnique).mockResolvedValue({
      injectedPanelEnabled: false,
      includeSpam: false,
      includePromotions: false,
      blacklistedSenderEmails: [],
    } as never);

    const res = await get();
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ injectionDisabled: true });
    expect(db.emailThread.findMany).not.toHaveBeenCalled();
  });

  it("treats a workspace with no settings row as enabled", async () => {
    expect((await get()).status).toBe(200);
  });

  it("404s a workspace the caller is not a member of, without querying threads", async () => {
    vi.mocked(db.workspaceMember.findUnique).mockResolvedValue(null as never);
    expect((await get()).status).toBe(404);
    expect(db.emailThread.findMany).not.toHaveBeenCalled();
  });

  it("scopes every query to the workspace in the URL", async () => {
    await get("ws-other");
    for (const index of [0, 1, 2]) {
      expect(findManyWhere(index)).toMatchObject({ workspaceId: "ws-other" });
    }
  });

  // A preview depth, not a page: the header carries the true count.
  it("caps each section rather than paging", async () => {
    await get();
    for (const call of vi.mocked(db.emailThread.findMany).mock.calls) {
      expect(call[0] as { take: number }).toMatchObject({ take: 15 });
    }
  });
});
