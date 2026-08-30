import { vi, describe, it, expect, beforeEach } from "vitest";
import { authed, INTERNAL_TOKEN } from "./helpers.js";

vi.mock("@aziru/db", () => ({
  db: {
    workspace: { findMany: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));

import app, { sessionEpochCache } from "../app.js";
import { db } from "@aziru/db";
import { issueAccessToken } from "@aziru/auth";

const USER_ID = "user-1";

function authedUser(userId = USER_ID): RequestInit {
  return authed({}, userId);
}

beforeEach(() => {
  vi.clearAllMocks();
  // The epoch cache is a module singleton shared across cases; isolate each test.
  sessionEpochCache.clear();
  vi.mocked(db.workspace.findMany).mockResolvedValue([]);
  // Per-user-token path reads the account's current epoch; default matches the
  // epoch stamped in the test tokens (0) so a valid token authenticates.
  vi.mocked(db.user.findUnique).mockResolvedValue({ sessionEpoch: 0 } as never);
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

// ─── Per-user access token (native client) path ───────────────────────────────

describe("auth middleware: per-user access token", () => {
  it("authenticates a valid user JWT and scopes to its subject", async () => {
    const token = await issueAccessToken("jwt-user-7", 0);
    const res = await app.request("/workspaces", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(db.workspace.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { members: { some: { userId: "jwt-user-7" } } },
      })
    );
  });

  it("ignores a caller-supplied X-User-Id, trusting only the token subject", async () => {
    const token = await issueAccessToken("jwt-user-7", 0);
    await app.request("/workspaces", {
      headers: { Authorization: `Bearer ${token}`, "X-User-Id": "attacker-99" },
    });
    expect(db.workspace.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { members: { some: { userId: "jwt-user-7" } } },
      })
    );
  });

  it("returns 401 for an expired/garbage token that is neither secret nor valid JWT", async () => {
    const res = await app.request("/workspaces", {
      headers: { Authorization: "Bearer eyJ-not-a-real-token" },
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 when the token's epoch is below the account's current epoch (N3)", async () => {
    // Token minted at epoch 0, but the account has since bumped to 1 (password
    // reset / pre-hijack invalidation) → the still-unexpired token is rejected.
    const token = await issueAccessToken("jwt-user-7", 0);
    vi.mocked(db.user.findUnique).mockResolvedValue({ sessionEpoch: 1 } as never);
    const res = await app.request("/workspaces", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(401);
    expect(db.workspace.findMany).not.toHaveBeenCalled();
  });

  it("returns 401 when the token's account no longer exists", async () => {
    const token = await issueAccessToken("jwt-user-7", 0);
    vi.mocked(db.user.findUnique).mockResolvedValue(null as never);
    const res = await app.request("/workspaces", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(401);
  });

  it("fails open (allows the request) when the epoch check DB read errors on a cold cache", async () => {
    // Transient DB error and this instance never cached the user: the request
    // proceeds on the token's own signature rather than 500ing every native call.
    const token = await issueAccessToken("cold-user", 0);
    vi.mocked(db.user.findUnique).mockRejectedValue(new Error("db down"));
    const res = await app.request("/workspaces", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(db.workspace.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { members: { some: { userId: "cold-user" } } } }),
    );
  });

  it("still enforces a revocation from the cache even when the DB then errors", async () => {
    // Warm the cache with the account at epoch 1 via a valid request.
    vi.mocked(db.user.findUnique).mockResolvedValue({ sessionEpoch: 1 } as never);
    const warm = await issueAccessToken("jwt-user-7", 1);
    expect((await app.request("/workspaces", { headers: { Authorization: `Bearer ${warm}` } })).status).toBe(200);

    // DB now errors, but a stale token (epoch 0 < cached 1) must still be rejected.
    vi.mocked(db.user.findUnique).mockRejectedValue(new Error("db down"));
    const stale = await issueAccessToken("jwt-user-7", 0);
    const res = await app.request("/workspaces", { headers: { Authorization: `Bearer ${stale}` } });
    expect(res.status).toBe(401);
  });
});

// ─── onError safety net ───────────────────────────────────────────────────────

describe("onError", () => {
  it("turns an uncaught handler error into a JSON 500 instead of crashing", async () => {
    vi.mocked(db.workspace.findMany).mockRejectedValue(new Error("boom"));
    const res = await app.request("/workspaces", authedUser());
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: "Internal server error" });
  });
});

// ─── GET /workspaces user-scoping ─────────────────────────────────────────────

describe("GET /workspaces", () => {
  it("returns empty array and skips DB query when no X-User-Id header", async () => {
    const res = await app.request("/workspaces", authed({}, null));
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
