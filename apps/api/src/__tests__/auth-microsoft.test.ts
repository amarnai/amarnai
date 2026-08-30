import { vi, describe, it, expect, beforeEach } from "vitest";

// config.outlook.enabled is derived from these at module init, so they must be
// set before the app (and @aziru/config) is imported. vi.hoisted runs first.
vi.hoisted(() => {
  process.env["MS_GRAPH_CLIENT_ID"] = "ms-client-id";
  process.env["MS_GRAPH_CLIENT_SECRET"] = "ms-client-secret";
});

vi.mock("@aziru/db", () => ({
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

vi.mock("@aziru/outlook", async (importActual) => {
  const actual = await importActual<typeof import("@aziru/outlook")>();
  return {
    ...actual,
    // Only the network calls are stubbed; parseGrantedScopes stays real so the
    // route's scope gate is exercised rather than mocked away.
    exchangeAuthCode: vi.fn(),
    fetchOutlookProfile: vi.fn(),
  };
});

vi.mock("@aziru/auth", () => ({
  provisionMicrosoftUser: vi.fn(),
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

vi.mock("../services/outlook-subscription.js", () => ({
  registerOutlookSubscription: vi.fn().mockResolvedValue({ ok: true, expiresAt: new Date() }),
}));

import app from "../app.js";
import {
  exchangeAuthCode,
  fetchOutlookProfile,
  MicrosoftApiError,
  OUTLOOK_UPFRONT_CONSENT_SCOPES,
} from "@aziru/outlook";
import { config } from "@aziru/config";
import { provisionLabelsQueue } from "../queues.js";
import { provisionMicrosoftUser, issueAccessToken } from "@aziru/auth";
import { db, maybeCreateExtensionNudge } from "@aziru/db";
import { syncInboxQueue } from "../services/queue-client.js";
import { registerOutlookSubscription } from "../services/outlook-subscription.js";

const OUTLOOK_SCOPES = "Mail.Read offline_access User.Read";
const REDIRECT_URI = "https://abcdefghijklmnop.chromiumapp.org/";

async function post(body: unknown): Promise<Response> {
  return app.request("/auth/microsoft", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept-Language": "fr-FR,fr;q=0.9" },
    body: JSON.stringify(body),
  });
}

// The extension runs the Microsoft code flow via chrome.identity and posts the
// code plus the chromiumapp.org redirect it was minted for.
const VALID_BODY = {
  code: "ms-code-123",
  scope: OUTLOOK_SCOPES,
  redirectUri: REDIRECT_URI,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(exchangeAuthCode).mockResolvedValue({
    accessToken: "ms-at",
    refreshToken: "ms-rt",
    scope: OUTLOOK_SCOPES,
    expiresAt: new Date("2030-01-01T00:00:00.000Z"),
    accountType: "ORGANIZATION",
  });
  vi.mocked(fetchOutlookProfile).mockResolvedValue({
    emailAddress: "a@b.com",
    subjectId: "entra-oid-1",
    displayName: "Test M",
  });
  vi.mocked(provisionMicrosoftUser).mockResolvedValue({
    userId: "user-1",
    workspaceId: "ws-1",
    isNew: true,
    outlookConnected: true,
  });
});

describe("POST /auth/microsoft", () => {
  it("redeems the code, provisions from the Graph identity, and returns a token pair", async () => {
    const res = await post(VALID_BODY);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      accessToken: "access-tok",
      refreshToken: "refresh-tok",
      refreshTokenExpiresAt: "2030-01-01T00:00:00.000Z",
    });
    // Redeemed against exactly what the client consented to: this body carries no
    // openid, so neither may the redemption (Microsoft rejects a wider one).
    expect(exchangeAuthCode).toHaveBeenCalledWith(
      "ms-code-123",
      REDIRECT_URI,
      undefined,
      OUTLOOK_SCOPES
    );
    expect(provisionMicrosoftUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "a@b.com",
        name: "Test M",
        outlookAccessToken: "ms-at",
        outlookRefreshToken: "ms-rt",
        grantedScopes: ["Mail.Read", "offline_access", "User.Read"],
        // From the id_token's tenant claim; decides which Outlook web host the
        // mailbox opens on.
        outlookAccountType: "ORGANIZATION",
        // Seeded from Accept-Language, so a French signup gets a French workspace.
        locale: "fr",
      })
    );
  });

  it("redeems WITH openid, and records a personal account, once the client asks for it", async () => {
    // Current extension builds request the sign-in scope, which is what makes
    // the id_token (and so the account type) available at all.
    vi.mocked(exchangeAuthCode).mockResolvedValue({
      accessToken: "ms-at",
      refreshToken: "ms-rt",
      scope: OUTLOOK_SCOPES,
      expiresAt: new Date("2030-01-01T00:00:00.000Z"),
      accountType: "PERSONAL",
    });

    const res = await post({ ...VALID_BODY, scope: `openid ${OUTLOOK_SCOPES}` });

    expect(res.status).toBe(200);
    expect(exchangeAuthCode).toHaveBeenCalledWith(
      "ms-code-123",
      REDIRECT_URI,
      undefined,
      `openid ${OUTLOOK_SCOPES}`
    );
    expect(provisionMicrosoftUser).toHaveBeenCalledWith(
      expect.objectContaining({ outlookAccountType: "PERSONAL" })
    );
  });

  it("never mints an epoch-0 token: a null account read fails the mint instead", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValueOnce(null as never);
    const res = await post(VALID_BODY);
    expect(res.status).toBe(500);
    expect(issueAccessToken).not.toHaveBeenCalled();
  });

  it("enqueues an initial sync and registers the Graph subscription for a new user", async () => {
    await post(VALID_BODY);
    expect(syncInboxQueue.add).toHaveBeenCalledWith(
      "sync-inbox",
      { workspaceId: "ws-1" },
      { deduplication: { id: "sync-inbox_ws-1" } }
    );
    expect(registerOutlookSubscription).toHaveBeenCalledWith("ws-1");
  });

  it("does neither for a returning user", async () => {
    vi.mocked(provisionMicrosoftUser).mockResolvedValue({
      userId: "user-1",
      workspaceId: "ws-1",
      isNew: false,
      outlookConnected: true,
    });
    await post(VALID_BODY);
    expect(syncInboxQueue.add).not.toHaveBeenCalled();
    expect(registerOutlookSubscription).not.toHaveBeenCalled();
  });

  it("fires the extension-install nudge whenever the inbox is connected", async () => {
    await post(VALID_BODY);
    await vi.waitFor(() =>
      expect(maybeCreateExtensionNudge).toHaveBeenCalledWith({
        userId: "user-1",
        workspaceId: "ws-1",
      })
    );
  });

  it("does not nudge when the grant produced no connection", async () => {
    vi.mocked(provisionMicrosoftUser).mockResolvedValue({
      userId: "user-1",
      workspaceId: null,
      isNew: true,
      outlookConnected: false,
    });
    await post(VALID_BODY);
    expect(maybeCreateExtensionNudge).not.toHaveBeenCalled();
  });

  it("rejects a request missing the code with 400", async () => {
    const res = await post({ scope: OUTLOOK_SCOPES, redirectUri: REDIRECT_URI });
    expect(res.status).toBe(400);
    expect(exchangeAuthCode).not.toHaveBeenCalled();
    expect(provisionMicrosoftUser).not.toHaveBeenCalled();
  });

  it("requires redirectUri — the extension flow is the only caller", async () => {
    const res = await post({ code: "ms-code-123", scope: OUTLOOK_SCOPES });
    expect(res.status).toBe(400);
    expect(exchangeAuthCode).not.toHaveBeenCalled();
  });

  it("returns 403 and redeems nothing when Mail.Read was not claimed", async () => {
    const res = await post({ ...VALID_BODY, scope: "offline_access User.Read" });
    expect(res.status).toBe(403);
    expect(exchangeAuthCode).not.toHaveBeenCalled();
    expect(provisionMicrosoftUser).not.toHaveBeenCalled();
  });

  it("returns 403 when the token response drops Mail.Read, even if the client claimed it", async () => {
    // The authoritative check is on what Microsoft actually granted, not on the
    // scope string the client sent.
    vi.mocked(exchangeAuthCode).mockResolvedValue({
      accessToken: "ms-at",
      refreshToken: "ms-rt",
      scope: "offline_access User.Read",
      expiresAt: new Date("2030-01-01T00:00:00.000Z"),
      accountType: "ORGANIZATION",
    });
    const res = await post(VALID_BODY);
    expect(res.status).toBe(403);
    expect(provisionMicrosoftUser).not.toHaveBeenCalled();
  });

  it("returns 502 when the code exchange fails", async () => {
    vi.mocked(exchangeAuthCode).mockRejectedValue(new MicrosoftApiError("invalid_grant", 400));
    const res = await post(VALID_BODY);
    expect(res.status).toBe(502);
    expect(provisionMicrosoftUser).not.toHaveBeenCalled();
  });

  it("returns 502 when the Graph profile cannot be read", async () => {
    vi.mocked(fetchOutlookProfile).mockRejectedValue(new Error("graph /me failed"));
    const res = await post(VALID_BODY);
    expect(res.status).toBe(502);
    expect(provisionMicrosoftUser).not.toHaveBeenCalled();
  });
});

describe("POST /auth/microsoft — upfront write grant", () => {
  function withFlag(on: boolean, run: () => Promise<void>): Promise<void> {
    const original = config.mail.labelWritebackEnabled;
    (config.mail as { labelWritebackEnabled: boolean }).labelWritebackEnabled = on;
    return run().finally(() => {
      (config.mail as { labelWritebackEnabled: boolean }).labelWritebackEnabled = original;
    });
  }

  it("redeems with the write scopes a write build authorized", async () => {
    // The silent-drop bug: Microsoft refresh tokens are scope-bound, so redeeming
    // a write grant with the read-only set mints a token that can never write and
    // reports no error anywhere.
    vi.mocked(exchangeAuthCode).mockResolvedValue({
      accessToken: "ms-at",
      refreshToken: "ms-rt",
      scope: OUTLOOK_UPFRONT_CONSENT_SCOPES,
      expiresAt: new Date("2030-01-01T00:00:00.000Z"),
      accountType: "ORGANIZATION",
    });

    const res = await post({ ...VALID_BODY, scope: OUTLOOK_UPFRONT_CONSENT_SCOPES });
    expect(res.status).toBe(200);
    expect(exchangeAuthCode).toHaveBeenCalledWith(
      "ms-code-123",
      REDIRECT_URI,
      undefined,
      OUTLOOK_UPFRONT_CONSENT_SCOPES,
    );
  });

  it("enables writeback and enqueues provisioning when both write scopes were granted", async () => {
    await withFlag(true, async () => {
      vi.mocked(exchangeAuthCode).mockResolvedValue({
        accessToken: "ms-at",
        refreshToken: "ms-rt",
        scope: OUTLOOK_UPFRONT_CONSENT_SCOPES,
        expiresAt: new Date("2030-01-01T00:00:00.000Z"),
        accountType: "ORGANIZATION",
      });
      vi.mocked(db.emailConnection.findUnique).mockResolvedValue({
        provider: "OUTLOOK",
        status: "ACTIVE",
        grantedScopes: OUTLOOK_UPFRONT_CONSENT_SCOPES.split(" "),
      } as never);

      const res = await post({ ...VALID_BODY, scope: OUTLOOK_UPFRONT_CONSENT_SCOPES });
      expect(res.status).toBe(200);
      expect(db.gmailSyncSettings.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: { labelWritebackEnabled: true } }),
      );
      expect(provisionLabelsQueue.add).toHaveBeenCalledWith(
        "provision-folder-labels",
        { workspaceId: "ws-1", relabelThreads: true },
        { deduplication: { id: "provision_relabel_ws-1" } },
      );
    });
  });

  it("leaves writeback off for a half write grant", async () => {
    // Mail.ReadWrite without MailboxSettings.ReadWrite 403s on masterCategories,
    // so treating it as writeback-capable would provision-fail forever.
    await withFlag(true, async () => {
      vi.mocked(db.emailConnection.findUnique).mockResolvedValue({
        provider: "OUTLOOK",
        status: "ACTIVE",
        grantedScopes: ["Mail.ReadWrite", "offline_access", "User.Read"],
      } as never);

      const res = await post(VALID_BODY);
      expect(res.status).toBe(200);
      expect(db.gmailSyncSettings.upsert).not.toHaveBeenCalled();
      expect(provisionLabelsQueue.add).not.toHaveBeenCalled();
    });
  });
});
