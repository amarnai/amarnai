import { vi, describe, it, expect, beforeEach } from "vitest";
import { authed } from "./helpers.js";

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
  },
}));

import app from "../app.js";
import { db } from "@amarnai/db";

const WS_ID = "ws-1";
const THREAD_ID = "thread-1";
const USER_ID = "user-1";

const BASE_THREAD = { id: THREAD_ID };
const BASE_MEMBER = { userId: USER_ID };
const BASE_USER = { id: USER_ID, email: "alice@example.com", name: "Alice" };

function mockAll() {
  vi.mocked(db.emailThread.findFirst).mockResolvedValue(BASE_THREAD as never);
  vi.mocked(db.workspaceMember.findUnique).mockResolvedValue(BASE_MEMBER as never);
  vi.mocked(db.user.findUnique).mockResolvedValue(BASE_USER as never);
  vi.mocked(db.emailThread.update).mockResolvedValue({} as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  // requireWorkspaceMember middleware checks the authenticated user (X-User-Id).
  // Default to a valid member so middleware passes; individual tests can override.
  vi.mocked(db.workspaceMember.findUnique).mockResolvedValue(BASE_MEMBER as never);
});

describe("POST /workspaces/:workspaceId/email-threads/:threadId/resolve", () => {
  it("marks thread as done and returns doneMark", async () => {
    mockAll();

    const res = await app.request(
      `/workspaces/${WS_ID}/email-threads/${THREAD_ID}/resolve`,
      authed({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: USER_ID }),
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; doneMark: { userId: string; userEmail: string; userName: string; resolvedAt: string } };
    expect(body.ok).toBe(true);
    expect(body.doneMark.userId).toBe(USER_ID);
    expect(body.doneMark.userEmail).toBe("alice@example.com");
    expect(body.doneMark.userName).toBe("Alice");
    expect(body.doneMark.resolvedAt).toBeDefined();

    expect(db.emailThread.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: THREAD_ID },
        data: expect.objectContaining({ resolvedByUserId: USER_ID }),
      })
    );
  });

  it("returns 404 when thread not found", async () => {
    vi.mocked(db.emailThread.findFirst).mockResolvedValue(null);
    vi.mocked(db.workspaceMember.findUnique).mockResolvedValue(BASE_MEMBER as never);

    const res = await app.request(
      `/workspaces/${WS_ID}/email-threads/${THREAD_ID}/resolve`,
      authed({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: USER_ID }),
      })
    );

    expect(res.status).toBe(404);
    expect(db.emailThread.update).not.toHaveBeenCalled();
  });

  it("returns 403 when user is not a workspace member", async () => {
    vi.mocked(db.emailThread.findFirst).mockResolvedValue(BASE_THREAD as never);
    // First call: requireWorkspaceMember middleware checks the authed user — must pass.
    // Second call: route checks the body userId — returns null to trigger 403.
    vi.mocked(db.workspaceMember.findUnique)
      .mockResolvedValueOnce(BASE_MEMBER as never)
      .mockResolvedValueOnce(null);

    const res = await app.request(
      `/workspaces/${WS_ID}/email-threads/${THREAD_ID}/resolve`,
      authed({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: USER_ID }),
      })
    );

    expect(res.status).toBe(403);
    expect(db.emailThread.update).not.toHaveBeenCalled();
  });

  it("returns 400 when userId is missing", async () => {
    const res = await app.request(
      `/workspaces/${WS_ID}/email-threads/${THREAD_ID}/resolve`,
      authed({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
    );

    expect(res.status).toBe(400);
  });
});

describe("DELETE /workspaces/:workspaceId/email-threads/:threadId/resolve", () => {
  it("clears done mark and returns null doneMark", async () => {
    mockAll();

    const res = await app.request(
      `/workspaces/${WS_ID}/email-threads/${THREAD_ID}/resolve`,
      authed({
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: USER_ID }),
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; doneMark: null };
    expect(body.ok).toBe(true);
    expect(body.doneMark).toBeNull();

    expect(db.emailThread.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: THREAD_ID },
        data: { resolvedByUserId: null, resolvedAt: null },
      })
    );
  });

  it("returns 404 when thread not found", async () => {
    vi.mocked(db.emailThread.findFirst).mockResolvedValue(null);
    vi.mocked(db.workspaceMember.findUnique).mockResolvedValue(BASE_MEMBER as never);

    const res = await app.request(
      `/workspaces/${WS_ID}/email-threads/${THREAD_ID}/resolve`,
      authed({
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: USER_ID }),
      })
    );

    expect(res.status).toBe(404);
    expect(db.emailThread.update).not.toHaveBeenCalled();
  });

  it("returns 403 when user is not a workspace member", async () => {
    vi.mocked(db.emailThread.findFirst).mockResolvedValue(BASE_THREAD as never);
    // First call: requireWorkspaceMember middleware checks the authed user — must pass.
    // Second call: route checks the body userId — returns null to trigger 403.
    vi.mocked(db.workspaceMember.findUnique)
      .mockResolvedValueOnce(BASE_MEMBER as never)
      .mockResolvedValueOnce(null);

    const res = await app.request(
      `/workspaces/${WS_ID}/email-threads/${THREAD_ID}/resolve`,
      authed({
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: USER_ID }),
      })
    );

    expect(res.status).toBe(403);
    expect(db.emailThread.update).not.toHaveBeenCalled();
  });
});
