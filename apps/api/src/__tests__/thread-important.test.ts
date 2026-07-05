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
  },
}));

import app from "../app.js";
import { db } from "@amarnai/db";

const WS_ID = "ws-1";
const THREAD_ID = "thread-1";

const BASE_THREAD = { id: THREAD_ID };
const BASE_MEMBER = { userId: TEST_USER_ID };

function req(body: unknown) {
  return authed({
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.workspaceMember.findUnique).mockResolvedValue(BASE_MEMBER as never);
  vi.mocked(db.emailThread.findFirst).mockResolvedValue(BASE_THREAD as never);
  vi.mocked(db.emailThread.update).mockResolvedValue({} as never);
});

describe("PATCH /workspaces/:workspaceId/email-threads/:threadId/important", () => {
  it("marks a thread important and persists isImportant=true", async () => {
    const res = await app.request(
      `/workspaces/${WS_ID}/email-threads/${THREAD_ID}/important`,
      req({ isImportant: true })
    );

    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; isImportant: boolean };
    expect(body).toEqual({ ok: true, isImportant: true });
    expect(db.emailThread.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: THREAD_ID },
        data: { isImportant: true },
      })
    );
  });

  it("clears the important star when isImportant=false", async () => {
    const res = await app.request(
      `/workspaces/${WS_ID}/email-threads/${THREAD_ID}/important`,
      req({ isImportant: false })
    );

    expect(res.status).toBe(200);
    const body = await res.json() as { isImportant: boolean };
    expect(body.isImportant).toBe(false);
    expect(db.emailThread.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isImportant: false } })
    );
  });

  it("rejects a missing/invalid isImportant with 400", async () => {
    const res = await app.request(
      `/workspaces/${WS_ID}/email-threads/${THREAD_ID}/important`,
      req({})
    );

    expect(res.status).toBe(400);
    expect(db.emailThread.update).not.toHaveBeenCalled();
  });

  it("returns 404 when the thread is not found", async () => {
    vi.mocked(db.emailThread.findFirst).mockResolvedValue(null);

    const res = await app.request(
      `/workspaces/${WS_ID}/email-threads/${THREAD_ID}/important`,
      req({ isImportant: true })
    );

    expect(res.status).toBe(404);
    expect(db.emailThread.update).not.toHaveBeenCalled();
  });

  it("returns 404 when the authenticated user is not a workspace member", async () => {
    vi.mocked(db.workspaceMember.findUnique).mockResolvedValue(null);

    const res = await app.request(
      `/workspaces/${WS_ID}/email-threads/${THREAD_ID}/important`,
      req({ isImportant: true })
    );

    expect(res.status).toBe(404);
    expect(db.emailThread.update).not.toHaveBeenCalled();
  });
});
