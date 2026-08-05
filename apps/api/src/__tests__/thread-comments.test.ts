import { vi, describe, it, expect, beforeEach } from "vitest";
import { authed, TEST_USER_ID } from "./helpers.js";
import { MAX_COMMENT_LENGTH, MAX_MENTIONS_PER_COMMENT } from "@amarnai/shared";

// Notification production is a best-effort side effect; mock it so we can
// assert it fires (or doesn't) without a DB or Redis.
const createNotification = vi.fn().mockResolvedValue(undefined);
const deleteCommentMentionNotifications = vi.fn().mockResolvedValue(undefined);

vi.mock("@amarnai/db", () => ({
  db: {
    emailThread: {
      findFirst: vi.fn(),
    },
    threadComment: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    threadCommentRead: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    workspaceMember: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
  },
  createNotification: (...args: unknown[]) => createNotification(...args),
  deleteCommentMentionNotifications: (...args: unknown[]) =>
    deleteCommentMentionNotifications(...args),
}));

const queueAdd = vi.fn().mockResolvedValue(undefined);
vi.mock("../queues.js", () => ({
  pushNotificationQueue: { add: (...args: unknown[]) => queueAdd(...args) },
}));

// Allowed by default; individual tests flip it to exercise the 429 path. The
// module's other exports (the rateLimit middleware factory app.ts uses) stay
// real.
const throttleOnce = vi.fn().mockResolvedValue(true);
vi.mock("../services/rate-limit.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/rate-limit.js")>()),
  throttleOnce: (...args: unknown[]) => throttleOnce(...args),
}));

import app from "../app.js";
import { db } from "@amarnai/db";

const WS_ID = "ws-1";
const THREAD_ID = "thread-1";
const MENTIONED_ID = "user-b";
const COMMENT_ID = "comment-1";

const BASE_THREAD = { id: THREAD_ID, subject: "Invoice" };
const ACTOR_ROW = { id: TEST_USER_ID, name: "Alice", email: "alice@example.com" };

function commentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: COMMENT_ID,
    body: "Looks resolved to me",
    mentionUserIds: [],
    createdAt: new Date("2026-08-05T10:00:00Z"),
    author: ACTOR_ROW,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  createNotification.mockClear();
  deleteCommentMentionNotifications.mockClear();
  queueAdd.mockClear();
  throttleOnce.mockResolvedValue(true);
  vi.mocked(db.emailThread.findFirst).mockResolvedValue(BASE_THREAD as never);
  // The middleware's membership check (the actor).
  vi.mocked(db.workspaceMember.findUnique).mockResolvedValue({ userId: TEST_USER_ID } as never);
  // The route's mention-validation lookup: echoes back every requested id.
  vi.mocked(db.workspaceMember.findMany).mockImplementation((async (args: {
    where: { userId: { in: string[] } };
  }) => args.where.userId.in.map((userId: string) => ({ userId }))) as never);
  vi.mocked(db.threadComment.findMany).mockResolvedValue([] as never);
  vi.mocked(db.threadComment.count).mockResolvedValue(0 as never);
  vi.mocked(db.threadComment.create).mockResolvedValue(commentRow() as never);
  vi.mocked(db.threadComment.delete).mockResolvedValue({} as never);
  vi.mocked(db.threadCommentRead.findUnique).mockResolvedValue(null as never);
  vi.mocked(db.threadCommentRead.upsert).mockResolvedValue({} as never);
});

const BASE = `/workspaces/${WS_ID}/email-threads/${THREAD_ID}/comments`;

function createReq(body: unknown) {
  return app.request(
    BASE,
    authed({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("GET /workspaces/:workspaceId/email-threads/:threadId/comments", () => {
  it("returns the comments oldest-first with the caller's read marker", async () => {
    vi.mocked(db.threadComment.findMany).mockResolvedValue([commentRow()] as never);
    vi.mocked(db.threadCommentRead.findUnique).mockResolvedValue(
      { lastReadAt: new Date("2026-08-04T09:00:00Z") } as never,
    );

    const res = await app.request(BASE, authed());

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      comments: Array<{ id: string; author: { userId: string } }>;
      lastReadAt: string | null;
    };
    expect(body.comments).toHaveLength(1);
    expect(body.comments[0]!.id).toBe(COMMENT_ID);
    expect(body.comments[0]!.author.userId).toBe(TEST_USER_ID);
    expect(body.lastReadAt).toBe("2026-08-04T09:00:00.000Z");
    expect(db.threadComment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: "asc" } }),
    );
  });

  it("returns lastReadAt null when the caller never opened the comments", async () => {
    const res = await app.request(BASE, authed());
    const body = (await res.json()) as { lastReadAt: string | null };
    expect(body.lastReadAt).toBeNull();
  });

  it("returns 404 when the thread is in another workspace", async () => {
    vi.mocked(db.emailThread.findFirst).mockResolvedValue(null);
    const res = await app.request(BASE, authed());
    expect(res.status).toBe(404);
  });

  it("returns 404 when the authenticated user is not a workspace member", async () => {
    vi.mocked(db.workspaceMember.findUnique).mockResolvedValue(null);
    const res = await app.request(BASE, authed());
    expect(res.status).toBe(404);
    expect(db.threadComment.findMany).not.toHaveBeenCalled();
  });
});

describe("GET .../comments/meta", () => {
  it("returns total and unread, excluding the caller's own comments", async () => {
    vi.mocked(db.threadCommentRead.findUnique).mockResolvedValue(
      { lastReadAt: new Date("2026-08-04T09:00:00Z") } as never,
    );
    vi.mocked(db.threadComment.count).mockImplementation((async (args: {
      where: { authorUserId?: { not: string } };
    }) => (args.where.authorUserId ? 2 : 5)) as never);

    const res = await app.request(`${BASE}/meta`, authed());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ total: 5, unread: 2 });
    // The unread count must exclude own comments and respect the read marker.
    expect(db.threadComment.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          authorUserId: { not: TEST_USER_ID },
          createdAt: { gt: new Date("2026-08-04T09:00:00Z") },
        }),
      }),
    );
  });

  it("counts every foreign comment as unread when there is no read marker", async () => {
    vi.mocked(db.threadComment.count).mockImplementation((async (args: {
      where: { authorUserId?: { not: string }; createdAt?: unknown };
    }) => {
      if (args.where.authorUserId) {
        expect(args.where.createdAt).toBeUndefined();
        return 3;
      }
      return 4;
    }) as never);

    const res = await app.request(`${BASE}/meta`, authed());
    expect(await res.json()).toEqual({ total: 4, unread: 3 });
  });
});

describe("POST .../comments/read", () => {
  it("upserts the caller's read marker and is idempotent", async () => {
    const first = await app.request(`${BASE}/read`, authed({ method: "POST" }));
    const second = await app.request(`${BASE}/read`, authed({ method: "POST" }));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(db.threadCommentRead.upsert).toHaveBeenCalledTimes(2);
    expect(db.threadCommentRead.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { emailThreadId_userId: { emailThreadId: THREAD_ID, userId: TEST_USER_ID } },
        create: expect.objectContaining({ workspaceId: WS_ID, userId: TEST_USER_ID }),
      }),
    );
  });
});

describe("POST /workspaces/:workspaceId/email-threads/:threadId/comments", () => {
  it("creates a comment and returns it with the author echo", async () => {
    const res = await createReq({ body: "Looks resolved to me" });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { ok: boolean; comment: { id: string; body: string } };
    expect(body.ok).toBe(true);
    expect(body.comment.id).toBe(COMMENT_ID);
    expect(db.threadComment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          workspaceId: WS_ID,
          emailThreadId: THREAD_ID,
          authorUserId: TEST_USER_ID,
          body: "Looks resolved to me",
        }),
      }),
    );
  });

  it("audits the create without the comment body", async () => {
    await createReq({ body: "Sensitive quoted email content" });

    expect(db.auditLog.create).toHaveBeenCalledTimes(1);
    const call = vi.mocked(db.auditLog.create).mock.calls[0]![0] as {
      data: { eventType: string; metadata: Record<string, unknown> };
    };
    expect(call.data.eventType).toBe("comment.created");
    expect(JSON.stringify(call.data.metadata)).not.toContain("Sensitive");
  });

  it("rejects an empty body", async () => {
    const res = await createReq({ body: "   " });
    expect(res.status).toBe(400);
    expect(db.threadComment.create).not.toHaveBeenCalled();
  });

  it("rejects a body over the maximum length", async () => {
    const res = await createReq({ body: "a".repeat(MAX_COMMENT_LENGTH + 1) });
    expect(res.status).toBe(400);
    expect(db.threadComment.create).not.toHaveBeenCalled();
  });

  it("rejects more mentions than the cap", async () => {
    const mentionUserIds = Array.from(
      { length: MAX_MENTIONS_PER_COMMENT + 1 },
      (_, i) => `user-${i}`,
    );
    const res = await createReq({ body: "hi", mentionUserIds });
    expect(res.status).toBe(400);
    expect(db.threadComment.create).not.toHaveBeenCalled();
  });

  it("rejects a mention of a non-member", async () => {
    vi.mocked(db.workspaceMember.findMany).mockResolvedValue([] as never);
    const res = await createReq({ body: "hi", mentionUserIds: [MENTIONED_ID] });
    expect(res.status).toBe(400);
    expect(db.threadComment.create).not.toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalled();
  });

  it("returns 429 when the per-user throttle rejects", async () => {
    throttleOnce.mockResolvedValue(false);
    const res = await createReq({ body: "hi" });
    expect(res.status).toBe(429);
    expect(db.threadComment.create).not.toHaveBeenCalled();
  });

  it("returns 409 at the per-thread comment cap", async () => {
    vi.mocked(db.threadComment.count).mockResolvedValue(200 as never);
    const res = await createReq({ body: "hi" });
    expect(res.status).toBe(409);
    expect(db.threadComment.create).not.toHaveBeenCalled();
  });

  it("notifies and enqueues a push for a mentioned member, without the body", async () => {
    vi.mocked(db.threadComment.create).mockResolvedValue(
      commentRow({ mentionUserIds: [MENTIONED_ID] }) as never,
    );
    await createReq({ body: "ping @Bob", mentionUserIds: [MENTIONED_ID] });

    expect(createNotification).toHaveBeenCalledTimes(1);
    const call = createNotification.mock.calls[0]![0] as {
      userId: string;
      type: string;
      params: Record<string, unknown>;
    };
    expect(call.userId).toBe(MENTIONED_ID);
    expect(call.type).toBe("comment_mention");
    expect(call.params["threadId"]).toBe(THREAD_ID);
    expect(call.params["commentId"]).toBe(COMMENT_ID);
    expect(JSON.stringify(call.params)).not.toContain("ping @Bob");

    expect(queueAdd).toHaveBeenCalledWith(
      "comment_mention",
      expect.objectContaining({
        kind: "comment_mention",
        mentionedUserId: MENTIONED_ID,
        mentionedByUserId: TEST_USER_ID,
        commentId: COMMENT_ID,
      }),
    );
  });

  it("deduplicates repeated mention ids", async () => {
    await createReq({ body: "hi", mentionUserIds: [MENTIONED_ID, MENTIONED_ID] });

    expect(db.threadComment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ mentionUserIds: [MENTIONED_ID] }),
      }),
    );
    expect(createNotification).toHaveBeenCalledTimes(1);
  });

  it("does NOT notify on self-mention", async () => {
    await createReq({ body: "note to self", mentionUserIds: [TEST_USER_ID] });

    expect(createNotification).not.toHaveBeenCalled();
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it("still returns 201 when notification production fails", async () => {
    createNotification.mockRejectedValueOnce(new Error("redis down"));
    const res = await createReq({ body: "hi", mentionUserIds: [MENTIONED_ID] });
    expect(res.status).toBe(201);
  });
});

describe("DELETE .../comments/:commentId", () => {
  it("lets the author delete and clears mention notifications", async () => {
    vi.mocked(db.threadComment.findFirst).mockResolvedValue(
      { id: COMMENT_ID, authorUserId: TEST_USER_ID } as never,
    );

    const res = await app.request(`${BASE}/${COMMENT_ID}`, authed({ method: "DELETE" }));

    expect(res.status).toBe(200);
    expect(db.threadComment.delete).toHaveBeenCalledWith({ where: { id: COMMENT_ID } });
    expect(deleteCommentMentionNotifications).toHaveBeenCalledWith({
      workspaceId: WS_ID,
      commentId: COMMENT_ID,
    });
    expect(db.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventType: "comment.deleted" }),
      }),
    );
  });

  it("returns 403 when another member tries to delete", async () => {
    vi.mocked(db.threadComment.findFirst).mockResolvedValue(
      { id: COMMENT_ID, authorUserId: "someone-else" } as never,
    );

    const res = await app.request(`${BASE}/${COMMENT_ID}`, authed({ method: "DELETE" }));

    expect(res.status).toBe(403);
    expect(db.threadComment.delete).not.toHaveBeenCalled();
    expect(deleteCommentMentionNotifications).not.toHaveBeenCalled();
  });

  it("returns 404 for a comment outside this thread or workspace", async () => {
    vi.mocked(db.threadComment.findFirst).mockResolvedValue(null);

    const res = await app.request(`${BASE}/${COMMENT_ID}`, authed({ method: "DELETE" }));

    expect(res.status).toBe(404);
    expect(db.threadComment.delete).not.toHaveBeenCalled();
  });
});
