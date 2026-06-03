import { vi, describe, it, expect, beforeEach } from "vitest";
import { authed, INTERNAL_TOKEN } from "./helpers.js";

vi.mock("@amarnai/db", () => ({
  db: {
    workspace: { findMany: vi.fn() },
  },
}));

import app from "../app.js";
import { db } from "@amarnai/db";

const USER_ID = "user-1";

function authedUser(userId = USER_ID): RequestInit {
  return authed({ headers: { "X-User-Id": userId } });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.workspace.findMany).mockResolvedValue([]);
});

// ─── Auth middleware ──────────────────────────────────────────────────────────

describe("auth middleware", () => {
  it("passes /health without an Authorization header", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
  });

  it("returns 401 with no Authorization header", async () => {
    const res = await app.request("/workspaces");
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "Unauthorized" });
  });

  it("returns 401 with a wrong token", async () => {
    const res = await app.request("/workspaces", {
      headers: { Authorization: "Bearer wrong-secret" },
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 when Authorization header is missing the Bearer prefix", async () => {
    const res = await app.request("/workspaces", {
      headers: { Authorization: INTERNAL_TOKEN },
    });
    expect(res.status).toBe(401);
  });

  it("passes with the correct Bearer token", async () => {
    const res = await app.request("/workspaces", authed());
    expect(res.status).toBe(200);
  });
});

// ─── GET /workspaces user-scoping ─────────────────────────────────────────────

describe("GET /workspaces", () => {
  it("returns empty array and skips DB query when no X-User-Id header", async () => {
    const res = await app.request("/workspaces", authed());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
    expect(db.workspace.findMany).not.toHaveBeenCalled();
  });

  it("filters by userId from the X-User-Id header", async () => {
    await app.request("/workspaces", authedUser());
    expect(db.workspace.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { members: { some: { userId: USER_ID } } },
      })
    );
  });

  it("returns the workspaces the DB returns for that user", async () => {
    const fakeWorkspace = {
      id: "ws-1",
      name: "My Workspace",
      createdAt: new Date(),
      updatedAt: new Date(),
      owner: { id: USER_ID, email: "a@b.com", name: null },
      members: [],
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(db.workspace.findMany).mockResolvedValueOnce([fakeWorkspace] as any);

    const res = await app.request("/workspaces", authedUser());
    expect(res.status).toBe(200);
    const body = await res.json() as { id: string }[];
    expect(body).toHaveLength(1);
    expect(body[0]?.id).toBe("ws-1");
  });

  it("uses the userId from the header, not a hardcoded value", async () => {
    await app.request("/workspaces", authedUser("other-user-99"));
    expect(db.workspace.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { members: { some: { userId: "other-user-99" } } },
      })
    );
  });
});
