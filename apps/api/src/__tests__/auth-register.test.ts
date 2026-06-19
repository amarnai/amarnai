import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

vi.mock("@amarnai/db", () => ({ db: {} }));

vi.mock("@amarnai/gmail", () => {
  class GmailApiError extends Error {
    status: number;
    constructor(message: string, status = 400) {
      super(message);
      this.status = status;
    }
  }
  return {
    exchangeAuthCode: vi.fn(),
    fetchGmailProfile: vi.fn(),
    fetchGoogleUserInfo: vi.fn(),
    GMAIL_READONLY_SCOPE: "https://www.googleapis.com/auth/gmail.readonly",
    GmailApiError,
    GmailClient: class {},
    decrypt: vi.fn(),
    normalizeGmailThread: vi.fn(),
    revokeGoogleToken: vi.fn(),
  };
});

vi.mock("@amarnai/auth", () => ({
  registerWithPassword: vi.fn(),
  rotateVerificationToken: vi.fn(async () => "verif-tok"),
  issueAccessToken: vi.fn(async () => "access-tok"),
  issueRefreshToken: vi.fn(async () => ({
    token: "refresh-tok",
    expiresAt: new Date("2030-01-01T00:00:00.000Z"),
  })),
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
import { config } from "@amarnai/config";
import { registerWithPassword } from "@amarnai/auth";
import { sendVerificationEmail } from "@amarnai/email";

async function post(body: unknown): Promise<Response> {
  return app.request("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const TOKEN_PAIR = {
  accessToken: "access-tok",
  refreshToken: "refresh-tok",
  refreshTokenExpiresAt: "2030-01-01T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  config.waitlistMode = false;
});

afterEach(() => {
  config.waitlistMode = false;
});

describe("POST /auth/register", () => {
  it("creates the account, emails a link, and returns a token pair", async () => {
    vi.mocked(registerWithPassword).mockResolvedValue({
      status: "created",
      userId: "user-1",
      verificationToken: "verif-tok",
    });

    const res = await post({ email: "new@b.com", password: "password123" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(TOKEN_PAIR);
    expect(registerWithPassword).toHaveBeenCalledWith({
      email: "new@b.com",
      password: "password123",
    });
    expect(sendVerificationEmail).toHaveBeenCalledWith("new@b.com", "verif-tok");
  });

  it("treats an unverified resend as success", async () => {
    vi.mocked(registerWithPassword).mockResolvedValue({
      status: "resent",
      userId: "user-1",
      verificationToken: "verif-tok",
    });

    const res = await post({ email: "u@b.com", password: "password123" });

    expect(res.status).toBe(200);
    expect(sendVerificationEmail).toHaveBeenCalledWith("u@b.com", "verif-tok");
  });

  it("returns 409 for an already-registered email", async () => {
    vi.mocked(registerWithPassword).mockResolvedValue({ status: "exists" });

    const res = await post({ email: "v@b.com", password: "password123" });

    expect(res.status).toBe(409);
    expect(sendVerificationEmail).not.toHaveBeenCalled();
  });

  it("returns 409 and directs Google-only accounts to sign in with Google", async () => {
    vi.mocked(registerWithPassword).mockResolvedValue({ status: "google_only" });

    const res = await post({ email: "g@b.com", password: "password123" });

    expect(res.status).toBe(409);
    expect(((await res.json()) as { error?: string }).error).toMatch(/Google/);
  });

  it("rejects an invalid email with 400 and never touches the db", async () => {
    const res = await post({ email: "not-an-email", password: "password123" });

    expect(res.status).toBe(400);
    expect(registerWithPassword).not.toHaveBeenCalled();
  });

  it("rejects a too-short password with 400", async () => {
    const res = await post({ email: "a@b.com", password: "short" });

    expect(res.status).toBe(400);
    expect(registerWithPassword).not.toHaveBeenCalled();
  });

  it("blocks sign-up with 403 in waitlist mode", async () => {
    config.waitlistMode = true;

    const res = await post({ email: "a@b.com", password: "password123" });

    expect(res.status).toBe(403);
    expect(registerWithPassword).not.toHaveBeenCalled();
    expect(sendVerificationEmail).not.toHaveBeenCalled();
  });
});
