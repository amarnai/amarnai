import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@amarnai/db", () => ({
  db: {
    // issueAccessTokenForUser reads the account's current epoch to stamp the token.
    user: { findUnique: vi.fn(async () => ({ sessionEpoch: 0 })) },
    // Read + written by the post-sign-in writeback enable step.
    emailConnection: { findUnique: vi.fn() },
    gmailSyncSettings: { upsert: vi.fn() },
  },
  maybeCreateExtensionNudge: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../queues.js", () => ({
  provisionLabelsQueue: { add: vi.fn().mockResolvedValue({}) },
}));

vi.mock("@amarnai/gmail", () => {
  class GmailApiError extends Error {
    status: number;
    constructor(message: string, status = 400) {
      super(message);
      this.status = status;
    }
  }
  class GmailClient {}
  const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
  const GMAIL_MODIFY_SCOPE = "https://www.googleapis.com/auth/gmail.modify";
  // Faithful to the real signature: providerHasWritebackScope (unmocked here)
  // calls into hasWritebackScope, and the route reads hasWriteback via the stored
  // scopes, so both must exist or the enable step sees undefined.
  const hasWritebackScope = (scopes: readonly string[]) => scopes.includes(GMAIL_MODIFY_SCOPE);
  return {
    fetchGmailProfile: vi.fn(),
    fetchGoogleUserInfo: vi.fn(),
    exchangeServerAuthCode: vi.fn(),
    exchangeAuthCode: vi.fn(),
    GMAIL_READONLY_SCOPE,
    GMAIL_MODIFY_SCOPE,
    hasWritebackScope,
    parseGrantedScopes: (scope: string) => {
      const scopes = scope.split(" ");
      return {
        scopes,
        hasReadonly: scopes.includes(GMAIL_READONLY_SCOPE) || hasWritebackScope(scopes),
        hasWriteback: hasWritebackScope(scopes),
      };
    },
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

vi.mock("../services/queue-client.js", () => ({
  syncInboxQueue: { add: vi.fn().mockResolvedValue({}) },
  backfillInboxQueue: { add: vi.fn().mockResolvedValue({}) },
}));

import app from "../app.js";
import {
  fetchGmailProfile,
  fetchGoogleUserInfo,
  exchangeServerAuthCode,
  exchangeAuthCode,
  GmailApiError,
} from "@amarnai/gmail";
import { provisionGoogleUser, issueAccessToken, rotateRefreshToken } from "@amarnai/auth";
import { db } from "@amarnai/db";
import { syncInboxQueue } from "../services/queue-client.js";
import { provisionLabelsQueue } from "../queues.js";
import { config } from "@amarnai/config";

const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

async function post(body: unknown): Promise<Response> {
  return app.request("/auth/google", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// The mobile app runs Google Sign-In (offlineAccess, Web client) and posts the
// resulting one-time serverAuthCode here; the API redeems it server-side.
const VALID_BODY = {
  serverAuthCode: "auth-code-123",
  scope: `openid email ${GMAIL_SCOPE}`,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(exchangeServerAuthCode).mockResolvedValue({
    accessToken: "google-at",
    refreshToken: "google-rt",
    scope: `openid email ${GMAIL_SCOPE}`,
    expiresAt: new Date("2030-01-01T00:00:00.000Z"),
  });
  vi.mocked(exchangeAuthCode).mockResolvedValue({
    accessToken: "google-at",
    refreshToken: "google-rt",
    scope: `openid email ${GMAIL_SCOPE}`,
    expiresAt: new Date("2030-01-01T00:00:00.000Z"),
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
  it("redeems the code, provisions the user, and returns an Amarnai token pair", async () => {
    const res = await post(VALID_BODY);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      accessToken: "access-tok",
      refreshToken: "refresh-tok",
      refreshTokenExpiresAt: "2030-01-01T00:00:00.000Z",
    });
    expect(exchangeServerAuthCode).toHaveBeenCalledWith("auth-code-123");
    expect(exchangeAuthCode).not.toHaveBeenCalled();
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

  it("never mints an epoch-0 token: a null account read fails the mint instead", async () => {
    // Replica lag / deletion race: the epoch read returns null. The mint must
    // fail (caught by onError → 500) rather than stamp a fallback epoch 0 that the
    // bearer check would then reject for the token's whole TTL.
    vi.mocked(db.user.findUnique).mockResolvedValueOnce(null as never);
    const res = await post(VALID_BODY);
    expect(res.status).toBe(500);
    expect(issueAccessToken).not.toHaveBeenCalled();
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

  it("rejects a request missing the serverAuthCode with 400", async () => {
    const res = await post({ scope: GMAIL_SCOPE });
    expect(res.status).toBe(400);
    expect(exchangeServerAuthCode).not.toHaveBeenCalled();
    expect(provisionGoogleUser).not.toHaveBeenCalled();
  });

  it("returns 403 and redeems nothing when gmail.readonly was not granted", async () => {
    const res = await post({ ...VALID_BODY, scope: "openid email" });
    expect(res.status).toBe(403);
    expect(exchangeServerAuthCode).not.toHaveBeenCalled();
    expect(provisionGoogleUser).not.toHaveBeenCalled();
  });

  it("returns 502 when the serverAuthCode exchange fails", async () => {
    vi.mocked(exchangeServerAuthCode).mockRejectedValue(new GmailApiError("invalid_grant", 400));
    const res = await post(VALID_BODY);
    expect(res.status).toBe(502);
    expect(provisionGoogleUser).not.toHaveBeenCalled();
  });

  it("returns 502 when the Gmail profile cannot be read", async () => {
    vi.mocked(fetchGmailProfile).mockRejectedValue(new Error("profile fetch failed"));
    const res = await post(VALID_BODY);
    expect(res.status).toBe(502);
    expect(provisionGoogleUser).not.toHaveBeenCalled();
  });

  it("redeems with the redirect URI when the extension supplies one", async () => {
    const redirectUri = "https://abcdefghijklmnop.chromiumapp.org/";
    const res = await post({ ...VALID_BODY, redirectUri });
    expect(res.status).toBe(200);
    expect(exchangeAuthCode).toHaveBeenCalledWith("auth-code-123", redirectUri);
    expect(exchangeServerAuthCode).not.toHaveBeenCalled();
  });

  it("rejects a non-URL redirectUri with 400 and redeems nothing", async () => {
    const res = await post({ ...VALID_BODY, redirectUri: "not-a-url" });
    expect(res.status).toBe(400);
    expect(exchangeAuthCode).not.toHaveBeenCalled();
    expect(exchangeServerAuthCode).not.toHaveBeenCalled();
    expect(provisionGoogleUser).not.toHaveBeenCalled();
  });
});

describe("POST /auth/google — label writeback on an upfront write grant", () => {
  const MODIFY_SCOPE = "https://www.googleapis.com/auth/gmail.modify";

  /** Point the exchange at a scope string and store it on the connection. */
  function grantedScope(scope: string): void {
    vi.mocked(exchangeServerAuthCode).mockResolvedValue({
      accessToken: "google-at",
      refreshToken: "google-rt",
      scope,
      expiresAt: new Date("2030-01-01T00:00:00.000Z"),
    });
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue({
      provider: "GMAIL",
      status: "ACTIVE",
      grantedScopes: scope.split(" "),
    } as never);
  }

  function withFlag(on: boolean, run: () => Promise<void>): Promise<void> {
    const original = config.mail.labelWritebackEnabled;
    (config.mail as { labelWritebackEnabled: boolean }).labelWritebackEnabled = on;
    return run().finally(() => {
      (config.mail as { labelWritebackEnabled: boolean }).labelWritebackEnabled = original;
    });
  }

  it("enables writeback and enqueues the relabel sweep when modify was granted", async () => {
    await withFlag(true, async () => {
      grantedScope(`openid email ${GMAIL_SCOPE} ${MODIFY_SCOPE}`);
      const res = await post({ ...VALID_BODY, scope: `openid email ${GMAIL_SCOPE} ${MODIFY_SCOPE}` });
      expect(res.status).toBe(200);

      expect(db.gmailSyncSettings.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { workspaceId: "ws-1" },
          update: { labelWritebackEnabled: true },
        }),
      );
      // The relabel dedup id, not the structural one: an existing inbox has to
      // catch up, and a folder-create provision must not coalesce the sweep away.
      expect(provisionLabelsQueue.add).toHaveBeenCalledWith(
        "provision-folder-labels",
        { workspaceId: "ws-1", relabelThreads: true },
        { deduplication: { id: "provision_relabel_ws-1" } },
      );
    });
  });

  it("does nothing for a read-only grant", async () => {
    await withFlag(true, async () => {
      grantedScope(`openid email ${GMAIL_SCOPE}`);
      const res = await post(VALID_BODY);
      expect(res.status).toBe(200);
      expect(db.gmailSyncSettings.upsert).not.toHaveBeenCalled();
      expect(provisionLabelsQueue.add).not.toHaveBeenCalled();
    });
  });

  it("does nothing, and reads no connection, when the deployment flag is off", async () => {
    // Production's current state: the whole feature must be inert, including the
    // DB read, until Google's gmail.modify verification clears.
    await withFlag(false, async () => {
      grantedScope(`openid email ${GMAIL_SCOPE} ${MODIFY_SCOPE}`);
      const res = await post({ ...VALID_BODY, scope: `openid email ${GMAIL_SCOPE} ${MODIFY_SCOPE}` });
      expect(res.status).toBe(200);
      expect(db.emailConnection.findUnique).not.toHaveBeenCalled();
      expect(db.gmailSyncSettings.upsert).not.toHaveBeenCalled();
      expect(provisionLabelsQueue.add).not.toHaveBeenCalled();
    });
  });
});

describe("POST /auth/refresh", () => {
  async function postRefresh(body: unknown): Promise<Response> {
    return app.request("/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("mints from the epoch rotateRefreshToken returns, with no second DB read", async () => {
    vi.mocked(rotateRefreshToken).mockResolvedValue({
      userId: "user-9",
      sessionEpoch: 5,
      refresh: { token: "refresh-tok", expiresAt: new Date("2030-01-01T00:00:00.000Z") },
    });

    const res = await postRefresh({ refreshToken: "rt-in" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      accessToken: "access-tok",
      refreshToken: "refresh-tok",
      refreshTokenExpiresAt: "2030-01-01T00:00:00.000Z",
    });
    // The access token is stamped with the epoch the rotation already read...
    expect(issueAccessToken).toHaveBeenCalledWith("user-9", 5);
    // ...so the refresh path never does a second post-rotation account read (the
    // read that used to throw after the single-use token was already consumed).
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });

  it("returns 401 when the refresh token is invalid/rotated/expired", async () => {
    vi.mocked(rotateRefreshToken).mockResolvedValue(null);
    const res = await postRefresh({ refreshToken: "bad" });
    expect(res.status).toBe(401);
    expect(issueAccessToken).not.toHaveBeenCalled();
  });
});
