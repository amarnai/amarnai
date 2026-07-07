import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@amarnai/db", () => ({ db: {} }));

vi.mock("@amarnai/gmail", () => ({
  // GmailClient is referenced at module load by @amarnai/mail's createMailProvider
  // (a MailProvider conformance check), so it must exist on the mock.
  GmailClient: vi.fn(),
  GmailAuthError: class GmailAuthError extends Error {},
  GmailHistoryCursorExpiredError: class GmailHistoryCursorExpiredError extends Error {},
  GmailThreadParseError: class GmailThreadParseError extends Error {},
  fetchGmailProfile: vi.fn(),
  fetchGoogleUserInfo: vi.fn(),
  parseGrantedScopes: vi.fn(),
}));

vi.mock("@amarnai/auth", () => ({
  createPasswordResetToken: vi.fn(),
  registerWithPassword: vi.fn(),
  rotateVerificationToken: vi.fn(),
  provisionGoogleUser: vi.fn(),
  issueAccessToken: vi.fn(),
  issueRefreshToken: vi.fn(),
  rotateRefreshToken: vi.fn(),
  revokeRefreshToken: vi.fn(),
  verifyCredentials: vi.fn(),
  verifyAccessToken: vi.fn(async () => null),
}));

vi.mock("@amarnai/email", () => ({
  sendVerificationEmail: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
}));

vi.mock("../services/queue-client.js", () => ({
  syncInboxQueue: { add: vi.fn().mockResolvedValue({}) },
  backfillInboxQueue: { add: vi.fn().mockResolvedValue({}) },
}));

import app from "../app.js";
import { createPasswordResetToken } from "@amarnai/auth";
import { sendPasswordResetEmail } from "@amarnai/email";

async function post(body: unknown): Promise<Response> {
  return app.request("/auth/forgot-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(sendPasswordResetEmail).mockResolvedValue(undefined);
});

describe("POST /auth/forgot-password", () => {
  it("emails a reset link when a token is issued and returns 200", async () => {
    vi.mocked(createPasswordResetToken).mockResolvedValue("reset-tok");

    const res = await post({ email: "a@b.com" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(createPasswordResetToken).toHaveBeenCalledWith("a@b.com");
    expect(sendPasswordResetEmail).toHaveBeenCalledWith("a@b.com", "reset-tok");
  });

  it("still returns 200 and sends no mail when no token is issued (silent success)", async () => {
    vi.mocked(createPasswordResetToken).mockResolvedValue(null);

    const res = await post({ email: "missing@b.com" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it("returns 200 even when the email fails to send (no existence oracle)", async () => {
    vi.mocked(createPasswordResetToken).mockResolvedValue("reset-tok");
    vi.mocked(sendPasswordResetEmail).mockRejectedValue(new Error("smtp down"));

    const res = await post({ email: "a@b.com" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("rejects an invalid email with 400 and issues no token", async () => {
    const res = await post({ email: "not-an-email" });

    expect(res.status).toBe(400);
    expect(createPasswordResetToken).not.toHaveBeenCalled();
  });
});
