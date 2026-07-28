import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@amarnai/db", () => ({
  db: { user: { findUnique: vi.fn(), update: vi.fn() } },
}));

vi.mock("@amarnai/gmail", () => ({
  exchangeAuthCode: vi.fn(),
  fetchGmailProfile: vi.fn(),
  fetchGoogleUserInfo: vi.fn(),
  GMAIL_READONLY_SCOPE: "https://www.googleapis.com/auth/gmail.readonly",
  GmailApiError: class extends Error {},
  GmailClient: class {},
  decrypt: vi.fn(),
  normalizeGmailThread: vi.fn(),
  revokeGoogleToken: vi.fn(),
}));

vi.mock("@amarnai/auth", () => ({
  registerEmail: vi.fn(),
  rotateVerificationToken: vi.fn(),
  issueAccessToken: vi.fn(),
  issueRefreshToken: vi.fn(),
  verifyAccessToken: vi.fn(async () => null),
  verifyCredentials: vi.fn(),
  checkUserPassword: vi.fn(),
  rotateRefreshToken: vi.fn(),
  revokeRefreshToken: vi.fn(),
  provisionGoogleUser: vi.fn(),
  StaleWhileErrorCache: class {
    async get(_k: string, loader: () => Promise<unknown>) {
      try {
        return { status: "loaded", value: await loader() };
      } catch {
        return { status: "unavailable", value: null };
      }
    }
    set() {}
    invalidate() {}
    clear() {}
  },
}));

vi.mock("@amarnai/auth/bridge-code", () => ({
  createBridgeCode: vi.fn(),
  inspectBridgeCode: vi.fn(),
  redeemBridgeCode: vi.fn(),
}));

vi.mock("@amarnai/email", () => ({ sendVerificationEmail: vi.fn(async () => {}) }));

vi.mock("../services/queue-client.js", () => ({
  syncInboxQueue: { add: vi.fn().mockResolvedValue({}) },
  backfillInboxQueue: { add: vi.fn().mockResolvedValue({}) },
}));

// The throttle is a Redis-backed no-op in tests unless a test drives it.
vi.mock("../services/rate-limit.js", () => ({
  throttleOnce: vi.fn(async () => true),
  checkRateLimit: vi.fn(async () => true),
  rateLimit: () => async (_c: unknown, next: () => Promise<void>) => next(),
}));

import app from "../app.js";
import { createBridgeCode, inspectBridgeCode, redeemBridgeCode } from "@amarnai/auth/bridge-code";
import { throttleOnce } from "../services/rate-limit.js";
import { authed, INTERNAL_TOKEN } from "./helpers.js";

const EXPIRES = new Date("2026-07-28T12:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(throttleOnce).mockResolvedValue(true);
  vi.mocked(createBridgeCode).mockResolvedValue({ code: "raw-code", expiresAt: EXPIRES });
});

describe("POST /auth/bridge/code", () => {
  it("mints a code for the authenticated user", async () => {
    const res = await app.request("/auth/bridge/code", authed({ method: "POST" }, "user-1"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ code: "raw-code", expiresAt: EXPIRES.toISOString() });
    expect(createBridgeCode).toHaveBeenCalledWith("user-1");
  });

  it("rejects an unauthenticated caller", async () => {
    const res = await app.request("/auth/bridge/code", { method: "POST" });

    expect(res.status).toBe(401);
    expect(createBridgeCode).not.toHaveBeenCalled();
  });

  it("rejects a trusted caller that names no user", async () => {
    const res = await app.request("/auth/bridge/code", authed({ method: "POST" }, null));

    expect(res.status).toBe(401);
    expect(createBridgeCode).not.toHaveBeenCalled();
  });

  it("throttles repeated minting per user", async () => {
    vi.mocked(throttleOnce).mockResolvedValue(false);

    const res = await app.request("/auth/bridge/code", authed({ method: "POST" }, "user-1"));

    expect(res.status).toBe(429);
    expect(throttleOnce).toHaveBeenCalledWith("bridge-code:user-1", expect.any(Number));
    expect(createBridgeCode).not.toHaveBeenCalled();
  });
});

describe("POST /auth/bridge/redeem", () => {
  const redeemRequest = (token: string | null, body: unknown = { code: "raw-code" }) => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    return app.request("/auth/bridge/redeem", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  };

  it("resolves the account behind a valid code for the internal caller", async () => {
    vi.mocked(redeemBridgeCode).mockResolvedValue({
      userId: "user-1",
      email: "a@b.com",
      emailVerified: true,
    });

    const res = await redeemRequest(INTERNAL_TOKEN);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      userId: "user-1",
      email: "a@b.com",
      emailVerified: true,
    });
    expect(redeemBridgeCode).toHaveBeenCalledWith("raw-code");
  });

  it("rejects a caller without the internal secret", async () => {
    const res = await redeemRequest("some-user-access-token");

    expect(res.status).toBe(401);
    expect(redeemBridgeCode).not.toHaveBeenCalled();
  });

  it("rejects a caller with no Authorization header", async () => {
    const res = await redeemRequest(null);

    expect(res.status).toBe(401);
    expect(redeemBridgeCode).not.toHaveBeenCalled();
  });

  it("rejects a malformed body", async () => {
    const res = await redeemRequest(INTERNAL_TOKEN, { notACode: true });

    expect(res.status).toBe(400);
    expect(redeemBridgeCode).not.toHaveBeenCalled();
  });

  it("returns 401 for an unknown, used, or expired code", async () => {
    vi.mocked(redeemBridgeCode).mockResolvedValue(null);

    const res = await redeemRequest(INTERNAL_TOKEN);

    expect(res.status).toBe(401);
  });
});

describe("POST /auth/bridge/inspect", () => {
  const inspectRequest = (token: string | null, body: unknown = { code: "raw-code" }) => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    return app.request("/auth/bridge/inspect", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  };

  it("resolves the account without spending the code", async () => {
    vi.mocked(inspectBridgeCode).mockResolvedValue({
      userId: "user-1",
      email: "a@b.com",
      emailVerified: true,
    });

    const res = await inspectRequest(INTERNAL_TOKEN);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      userId: "user-1",
      email: "a@b.com",
      emailVerified: true,
    });
    expect(inspectBridgeCode).toHaveBeenCalledWith("raw-code");
    // Inspecting must never consume: that is the whole reason it exists.
    expect(redeemBridgeCode).not.toHaveBeenCalled();
  });

  it("rejects a caller without the internal secret", async () => {
    const res = await inspectRequest("some-user-access-token");

    expect(res.status).toBe(401);
    expect(inspectBridgeCode).not.toHaveBeenCalled();
  });

  it("returns 401 for an unknown, used, or expired code", async () => {
    vi.mocked(inspectBridgeCode).mockResolvedValue(null);

    expect((await inspectRequest(INTERNAL_TOKEN)).status).toBe(401);
  });
});
