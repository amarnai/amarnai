import { vi, describe, it, expect, beforeEach } from "vitest";
import { authed, TEST_USER_ID } from "./helpers.js";

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

const BASE_THREAD = { id: THREAD_ID };
const BASE_MEMBER = { userId: TEST_USER_ID };
const BASE_USER = { id: TEST_USER_ID, email: "alice@example.com", name: "Alice" };

function mockAll() {
  vi.mocked(db.emailThread.findFirst).mockResolvedValue(BASE_THREAD as never);
  vi.mocked(db.user.findUnique).mockResolvedValue(BASE_USER as never);
  vi.mocked(db.emailThread.update).mockResolvedValue({} as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  // requireWorkspaceMember middleware checks the authenticated user (X-User-Id).
  // Default to a valid member so middleware passes; individual tests override.
  vi.mocked(db.workspaceMember.findUnique).mockResolvedValue(BASE_MEMBER as never);
});

describe("POST /workspaces/:workspaceId/email-threads/:threadId/resolve", () => {
  it("marks thread as done as the authenticated user and returns doneMark", async () => {
    mockAll();

    const res = await app.request(
      `/workspaces/${WS_ID}/email-threads/${THREAD_ID}/resolve`,
      authed({ method: "POST" })
    );

    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; doneMark: { userId: string; userEmail: string; userName: string; resolvedAt: string } };
    expect(body.ok).toBe(true);
    expect(body.doneMark.userId).toBe(TEST_USER_ID);
    expect(body.doneMark.userEmail).toBe("alice@example.com");
    expect(body.doneMark.resolvedAt).toBeDefined();

    expect(db.emailThread.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: THREAD_ID },
        data: expect.objectContaining({ resolvedByUserId: TEST_USER_ID }),
      })
    );
  });

  it("ignores any actor userId supplied in the body (IDOR regression)", async () => {
    mockAll();

    const res = await app.request(
      `/workspaces/${WS_ID}/email-threads/${THREAD_ID}/resolve`,
      authed({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "someone-else" }),
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json() as { doneMark: { userId: string } };
    // The actor is the authenticated user, never the body-supplied id.
    expect(body.doneMark.userId).toBe(TEST_USER_ID);
    expect(db.emailThread.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ resolvedByUserId: TEST_USER_ID }),
      })
    );
  });

  it("returns 404 when thread not found", async () => {
    vi.mocked(db.emailThread.findFirst).mockResolvedValue(null);

    const res = await app.request(
      `/workspaces/${WS_ID}/email-threads/${THREAD_ID}/resolve`,
      authed({ method: "POST" })
    );

    expect(res.status).toBe(404);
    expect(db.emailThread.update).not.toHaveBeenCalled();
  });

  it("returns 404 when the authenticated user is not a workspace member", async () => {
    // Middleware membership lookup misses → blocked before the route runs.
    vi.mocked(db.workspaceMember.findUnique).mockResolvedValue(null);

    const res = await app.request(
      `/workspaces/${WS_ID}/email-threads/${THREAD_ID}/resolve`,
      authed({ method: "POST" })
    );

    expect(res.status).toBe(404);
    expect(db.emailThread.update).not.toHaveBeenCalled();
  });
});

describe("DELETE /workspaces/:workspaceId/email-threads/:threadId/resolve", () => {
  it("clears done mark and returns null doneMark", async () => {
    mockAll();

    const res = await app.request(
      `/workspaces/${WS_ID}/email-threads/${THREAD_ID}/resolve`,
      authed({ method: "DELETE" })
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

    const res = await app.request(
      `/workspaces/${WS_ID}/email-threads/${THREAD_ID}/resolve`,
      authed({ method: "DELETE" })
    );

    expect(res.status).toBe(404);
    expect(db.emailThread.update).not.toHaveBeenCalled();
  });

  it("returns 404 when the authenticated user is not a workspace member", async () => {
    vi.mocked(db.workspaceMember.findUnique).mockResolvedValue(null);

    const res = await app.request(
      `/workspaces/${WS_ID}/email-threads/${THREAD_ID}/resolve`,
      authed({ method: "DELETE" })
    );

    expect(res.status).toBe(404);
    expect(db.emailThread.update).not.toHaveBeenCalled();
  });
});
