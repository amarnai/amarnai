import { vi, describe, it, expect, beforeEach } from "vitest";
import { authed, TEST_USER_ID } from "./helpers.js";

// createNotification and the push queue are best-effort side effects; mock them
// so we can assert they fire (or don't) without a DB or Redis.
const createNotification = vi.fn().mockResolvedValue(undefined);

vi.mock("@amarnai/db", () => ({
  db: {
    emailThread: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    workspaceMember: {
      findUnique: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
  },
  createNotification: (...args: unknown[]) => createNotification(...args),
}));

const queueAdd = vi.fn().mockResolvedValue(undefined);
vi.mock("../queues.js", () => ({
  pushNotificationQueue: { add: (...args: unknown[]) => queueAdd(...args) },
}));

import app from "../app.js";
import { db } from "@amarnai/db";

const WS_ID = "ws-1";
const THREAD_ID = "thread-1";
const ASSIGNEE_ID = "user-b";

const BASE_THREAD = { id: THREAD_ID, subject: "Invoice" };
const ACTOR = { id: TEST_USER_ID, email: "alice@example.com", name: "Alice" };
const ASSIGNEE = { id: ASSIGNEE_ID, email: "bob@example.com", name: "Bob" };

// db.workspaceMember.findUnique is called twice: once by requireWorkspaceMember
// (the actor) and once by the route (the assignee). Key the mock on the userId
// in the composite where so both lookups resolve independently.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function memberLookup(members: Set<string>): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async ({ where }: any) => {
    const userId = where.workspaceId_userId.userId;
    return members.has(userId) ? { userId } : null;
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function userLookup(): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async ({ where }: any) => {
    if (where.id === ASSIGNEE_ID) return ASSIGNEE;
    if (where.id === TEST_USER_ID) return ACTOR;
    return null;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  createNotification.mockClear();
  queueAdd.mockClear();
  vi.mocked(db.emailThread.findFirst).mockResolvedValue(BASE_THREAD as never);
  vi.mocked(db.emailThread.update).mockResolvedValue({} as never);
  vi.mocked(db.user.findUnique).mockImplementation(userLookup());
  // Actor + assignee are both members by default.
  vi.mocked(db.workspaceMember.findUnique).mockImplementation(
    memberLookup(new Set([TEST_USER_ID, ASSIGNEE_ID])),
  );
});

function assignReq(body: unknown) {
  return app.request(
    `/workspaces/${WS_ID}/email-threads/${THREAD_ID}/assignee`,
    authed({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /workspaces/:workspaceId/email-threads/:threadId/assignee", () => {
  it("assigns the thread to a member and returns the assignment", async () => {
    const res = await assignReq({ assigneeUserId: ASSIGNEE_ID });

    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; assignment: { userId: string; userEmail: string; userName: string; assignedAt: string } };
    expect(body.ok).toBe(true);
    expect(body.assignment.userId).toBe(ASSIGNEE_ID);
    expect(body.assignment.userEmail).toBe("bob@example.com");
    expect(body.assignment.assignedAt).toBeDefined();

    expect(db.emailThread.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: THREAD_ID },
        data: expect.objectContaining({
          assignedToUserId: ASSIGNEE_ID,
          assignedByUserId: TEST_USER_ID,
        }),
      }),
    );
  });

  it("records the actor from the auth context, never the body (IDOR regression)", async () => {
    await assignReq({ assigneeUserId: ASSIGNEE_ID, assignedByUserId: "someone-else" });

    expect(db.emailThread.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ assignedByUserId: TEST_USER_ID }),
      }),
    );
  });

  it("notifies and enqueues a push when assigning someone else", async () => {
    await assignReq({ assigneeUserId: ASSIGNEE_ID });

    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: ASSIGNEE_ID, type: "thread_assigned" }),
    );
    expect(queueAdd).toHaveBeenCalledWith(
      "thread_assigned",
      expect.objectContaining({ kind: "thread_assigned", assigneeUserId: ASSIGNEE_ID, assignedByUserId: TEST_USER_ID }),
    );
  });

  it("does NOT notify or push on self-assign", async () => {
    const res = await assignReq({ assigneeUserId: TEST_USER_ID });

    expect(res.status).toBe(200);
    expect(createNotification).not.toHaveBeenCalled();
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it("rejects a target who is not a member of the workspace", async () => {
    // Only the actor is a member; the assignee lookup misses.
    vi.mocked(db.workspaceMember.findUnique).mockImplementation(
      memberLookup(new Set([TEST_USER_ID])),
    );

    const res = await assignReq({ assigneeUserId: ASSIGNEE_ID });

    expect(res.status).toBe(400);
    expect(db.emailThread.update).not.toHaveBeenCalled();
  });

  it("returns 404 when the thread is in another workspace", async () => {
    vi.mocked(db.emailThread.findFirst).mockResolvedValue(null);

    const res = await assignReq({ assigneeUserId: ASSIGNEE_ID });

    expect(res.status).toBe(404);
    expect(db.emailThread.update).not.toHaveBeenCalled();
  });

  it("returns 404 when the authenticated user is not a workspace member", async () => {
    vi.mocked(db.workspaceMember.findUnique).mockImplementation(
      memberLookup(new Set([ASSIGNEE_ID])), // actor not a member → middleware blocks
    );

    const res = await assignReq({ assigneeUserId: ASSIGNEE_ID });

    expect(res.status).toBe(404);
    expect(db.emailThread.update).not.toHaveBeenCalled();
  });

  it("rejects a missing assigneeUserId", async () => {
    const res = await assignReq({});
    expect(res.status).toBe(400);
    expect(db.emailThread.update).not.toHaveBeenCalled();
  });
});

describe("DELETE /workspaces/:workspaceId/email-threads/:threadId/assignee", () => {
  it("clears the assignment and returns null", async () => {
    vi.mocked(db.emailThread.findFirst).mockResolvedValue(
      { id: THREAD_ID, assignedToUserId: ASSIGNEE_ID } as never,
    );

    const res = await app.request(
      `/workspaces/${WS_ID}/email-threads/${THREAD_ID}/assignee`,
      authed({ method: "DELETE" }),
    );

    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; assignment: null };
    expect(body.assignment).toBeNull();
    expect(db.emailThread.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ assignedToUserId: null, assignedByUserId: null, assignedAt: null }),
      }),
    );
  });
});
