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
  class GmailClient {}
  return {
    exchangeAuthCode: vi.fn(),
    fetchGmailProfile: vi.fn(),
    fetchGoogleUserInfo: vi.fn(),
    GmailApiError,
    GmailClient,
    decrypt: vi.fn(),
    normalizeGmailThread: vi.fn(),
    revokeGoogleToken: vi.fn(),
  };
});

vi.mock("@amarnai/auth", () => ({
  provisionGoogleUser: vi.fn(),
  issueAccessToken: vi.fn(async () => "access-tok"),
  issueRefreshToken: vi.fn(async () => ({
    token: "refresh-tok",
    expiresAt: new Date("2030-01-01T00:00:00.000Z"),
  })),
  verifyAccessToken: vi.fn(async () => null),
  verifyCredentials: vi.fn(),
  rotateRefreshToken: vi.fn(),
  revokeRefreshToken: vi.fn(),
  getOrCreateDefaultWorkspace: vi.fn(),
}));

vi.mock("../services/queue-client.js", () => ({
  syncInboxQueue: { add: vi.fn().mockResolvedValue({}) },
  backfillInboxQueue: { add: vi.fn().mockResolvedValue({}) },
}));

import app from "../app.js";
import {
  exchangeAuthCode,
  fetchGmailProfile,
  fetchGoogleUserInfo,
  GmailApiError,
} from "@amarnai/gmail";
import { provisionGoogleUser } from "@amarnai/auth";
import { syncInboxQueue } from "../services/queue-client.js";

const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

async function post(body: unknown): Promise<Response> {
  return app.request("/auth/google", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = { code: "auth-code", redirectUri: "amarnai://oauth", codeVerifier: "verifier" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(exchangeAuthCode).mockResolvedValue({
    accessToken: "google-at",
    refreshToken: "google-rt",
    scope: `openid email ${GMAIL_SCOPE}`,
    expiresAt: new Date(),
  });
  vi.mocked(fetchGmailProfile).mockResolvedValue({ emailAddress: "a@b.com" } as never);
  vi.mocked(fetchGoogleUserInfo).mockResolvedValue({ name: "Test G", picture: "http://img/p.png" });
  vi.mocked(provisionGoogleUser).mockResolvedValue({
    userId: "user-1",
    workspaceId: "ws-1",
    isNew: true,
    gmailConnected: true,
  });
});

describe("POST /auth/google", () => {
  it("provisions the user and returns an Amarnai token pair", async () => {
    const res = await post(VALID_BODY);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      accessToken: "access-tok",
      refreshToken: "refresh-tok",
      refreshTokenExpiresAt: "2030-01-01T00:00:00.000Z",
    });
    expect(exchangeAuthCode).toHaveBeenCalledWith("auth-code", "amarnai://oauth", "verifier");
    expect(provisionGoogleUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "a@b.com",
        name: "Test G",
        imageUrl: "http://img/p.png",
        gmailAccessToken: "google-at",
        gmailRefreshToken: "google-rt",
        grantedScopes: ["openid", "email", GMAIL_SCOPE],
      })
    );
  });

  it("enqueues an initial sync for a brand-new connected user", async () => {
    await post(VALID_BODY);
    expect(syncInboxQueue.add).toHaveBeenCalledWith(
      "sync-inbox",
      { workspaceId: "ws-1" },
      { deduplication: { id: "sync-inbox_ws-1" } }
    );
  });

  it("does not enqueue a sync for a returning user", async () => {
    vi.mocked(provisionGoogleUser).mockResolvedValue({
      userId: "user-1",
      workspaceId: "ws-1",
      isNew: false,
      gmailConnected: true,
    });
    await post(VALID_BODY);
    expect(syncInboxQueue.add).not.toHaveBeenCalled();
  });

  it("rejects a missing authorization code with 400", async () => {
    const res = await post({ redirectUri: "amarnai://oauth" });
    expect(res.status).toBe(400);
    expect(exchangeAuthCode).not.toHaveBeenCalled();
  });

  it("returns 403 and provisions nothing when gmail.readonly was not granted", async () => {
    vi.mocked(exchangeAuthCode).mockResolvedValue({
      accessToken: "google-at",
      refreshToken: "google-rt",
      scope: "openid email",
      expiresAt: new Date(),
    });
    const res = await post(VALID_BODY);
    expect(res.status).toBe(403);
    expect(provisionGoogleUser).not.toHaveBeenCalled();
  });

  it("returns 401 when the Google code exchange fails", async () => {
    vi.mocked(exchangeAuthCode).mockRejectedValue(new GmailApiError("invalid_grant", 401));
    const res = await post(VALID_BODY);
    expect(res.status).toBe(401);
    expect(provisionGoogleUser).not.toHaveBeenCalled();
  });
});
