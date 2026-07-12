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
      lifecycleEmailsEnabled: true,
    } as never);

    const res = await app.request("/auth/me", authed({ method: "GET" }, "user-1"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      userId: "user-1",
      email: "a@b.com",
      name: "Ann",
      emailVerified: true,
      lifecycleEmailsEnabled: true,
      hasPassword: false,
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

describe("PATCH /auth/me", () => {
  function mockUpdated(overrides: Record<string, unknown> = {}) {
    vi.mocked(db.user.update).mockResolvedValue({
      id: "user-1",
      email: "a@b.com",
      name: "Ann",
      emailVerified: new Date(),
      lifecycleEmailsEnabled: true,
      ...overrides,
    } as never);
  }

  it("updates only the display name when given just a name", async () => {
    mockUpdated({ name: "Bob" });

    const res = await app.request(
      "/auth/me",
      authed({ method: "PATCH", body: JSON.stringify({ name: "Bob" }) }, "user-1"),
    );

    expect(res.status).toBe(200);
    expect(vi.mocked(db.user.update).mock.calls[0]![0]).toMatchObject({
      where: { id: "user-1" },
      data: { name: "Bob" },
    });
    // lifecycleEmailsEnabled must NOT be touched when absent from the body.
    expect(vi.mocked(db.user.update).mock.calls[0]![0].data).not.toHaveProperty(
      "lifecycleEmailsEnabled",
    );
  });

  it("toggles lifecycleEmailsEnabled without clobbering the name", async () => {
    mockUpdated({ lifecycleEmailsEnabled: false });

    const res = await app.request(
      "/auth/me",
      authed(
        { method: "PATCH", body: JSON.stringify({ lifecycleEmailsEnabled: false }) },
        "user-1",
      ),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ lifecycleEmailsEnabled: false });
    const data = vi.mocked(db.user.update).mock.calls[0]![0].data;
    expect(data).toEqual({ lifecycleEmailsEnabled: false });
  });

  it("rejects a non-boolean lifecycleEmailsEnabled", async () => {
    const res = await app.request(
      "/auth/me",
      authed(
        { method: "PATCH", body: JSON.stringify({ lifecycleEmailsEnabled: "yes" }) },
        "user-1",
      ),
    );

    expect(res.status).toBe(400);
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("returns 401 without authentication", async () => {
    const res = await app.request("/auth/me", {
      method: "PATCH",
      body: JSON.stringify({ name: "X" }),
    });
    expect(res.status).toBe(401);
    expect(db.user.update).not.toHaveBeenCalled();
  });
});
