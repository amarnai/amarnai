import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@amarnai/db", () => ({
  db: { user: { findUnique: vi.fn() } },
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
  registerWithPassword: vi.fn(),
  rotateVerificationToken: vi.fn(),
  issueAccessToken: vi.fn(),
  issueRefreshToken: vi.fn(),
  verifyAccessToken: vi.fn(async () => null),
  verifyCredentials: vi.fn(),
  rotateRefreshToken: vi.fn(),
  revokeRefreshToken: vi.fn(),
  provisionGoogleUser: vi.fn(),
}));

vi.mock("@amarnai/email", () => ({ sendVerificationEmail: vi.fn(async () => {}) }));

vi.mock("../services/queue-client.js", () => ({
  syncInboxQueue: { add: vi.fn().mockResolvedValue({}) },
  backfillInboxQueue: { add: vi.fn().mockResolvedValue({}) },
}));

import app from "../app.js";
import { db } from "@amarnai/db";
import { authed } from "./helpers.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /auth/me", () => {
  it("returns the identity with emailVerified true for a verified user", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "user-1",
      email: "a@b.com",
      name: "Ann",
      emailVerified: new Date(),
    } as never);

    const res = await app.request("/auth/me", authed({ method: "GET" }, "user-1"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      userId: "user-1",
      email: "a@b.com",
      name: "Ann",
      emailVerified: true,
    });
  });

  it("reports emailVerified false when the user has not verified", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "user-1",
      email: "a@b.com",
      name: null,
      emailVerified: null,
    } as never);

    const res = await app.request("/auth/me", authed({ method: "GET" }, "user-1"));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ emailVerified: false, name: null });
  });

  it("returns 401 without authentication", async () => {
    const res = await app.request("/auth/me", { method: "GET" });
    expect(res.status).toBe(401);
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });

  it("returns 404 when the user no longer exists", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(null);

    const res = await app.request("/auth/me", authed({ method: "GET" }, "ghost"));

    expect(res.status).toBe(404);
  });
});
