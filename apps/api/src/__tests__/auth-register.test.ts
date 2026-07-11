import { vi, describe, it, expect, beforeEach } from "vitest";

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
  registerEmail: vi.fn(),
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

vi.mock("@amarnai/email", () => ({
  sendVerificationEmail: vi.fn(async () => {}),
  sendAccountExistsEmail: vi.fn(async () => {}),
  sendGoogleAccountEmail: vi.fn(async () => {}),
}));

vi.mock("../services/queue-client.js", () => ({
  syncInboxQueue: { add: vi.fn().mockResolvedValue({}) },
  backfillInboxQueue: { add: vi.fn().mockResolvedValue({}) },
}));

import app from "../app.js";
import { registerEmail } from "@amarnai/auth";
import {
  sendVerificationEmail,
  sendAccountExistsEmail,
  sendGoogleAccountEmail,
} from "@amarnai/email";

async function post(body: unknown): Promise<Response> {
  return app.request("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /auth/register", () => {
  it("returns a neutral { ok: true } and emails a verify link for a new/unverified email", async () => {
    vi.mocked(registerEmail).mockResolvedValue({
      status: "verify",
      verificationToken: "verif-tok",
    });

    const res = await post({ email: "new@b.com" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(registerEmail).toHaveBeenCalledWith({ email: "new@b.com" });
    expect(sendVerificationEmail).toHaveBeenCalledWith("new@b.com", "verif-tok");
  });

  it("emails the verify link is skipped when the resend is throttled", async () => {
    vi.mocked(registerEmail).mockResolvedValue({ status: "verify", verificationToken: null });

    const res = await post({ email: "u@b.com" });

    expect(res.status).toBe(200);
    expect(sendVerificationEmail).not.toHaveBeenCalled();
  });

  it("returns the SAME neutral response (no tokens) for an already-registered email, and emails a notice", async () => {
    vi.mocked(registerEmail).mockResolvedValue({ status: "already_registered" });

    const res = await post({ email: "v@b.com" });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ ok: true });
    expect(body).not.toHaveProperty("accessToken");
    // Sends are fire-and-forget (throttled per recipient), so wait for the notice.
    await vi.waitFor(() => expect(sendAccountExistsEmail).toHaveBeenCalledWith("v@b.com"));
    expect(sendVerificationEmail).not.toHaveBeenCalled();
  });

  it("returns the SAME neutral response for a Google-only email, and emails a Google notice", async () => {
    vi.mocked(registerEmail).mockResolvedValue({ status: "google_only" });

    const res = await post({ email: "g@b.com" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    await vi.waitFor(() => expect(sendGoogleAccountEmail).toHaveBeenCalledWith("g@b.com"));
  });

  it("ignores a legacy password field in the body (email-first)", async () => {
    vi.mocked(registerEmail).mockResolvedValue({ status: "verify", verificationToken: "verif-tok" });

    const res = await post({ email: "new@b.com", password: "whatever-they-typed" });

    expect(res.status).toBe(200);
    expect(registerEmail).toHaveBeenCalledWith({ email: "new@b.com" });
  });

  it("rejects an invalid email with 400 and never touches registration", async () => {
    const res = await post({ email: "not-an-email" });

    expect(res.status).toBe(400);
    expect(registerEmail).not.toHaveBeenCalled();
  });
});
