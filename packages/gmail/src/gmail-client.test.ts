import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

vi.mock("./encryption.js", () => ({
  decrypt: vi.fn().mockReturnValue("plain-refresh-token"),
  encrypt: vi.fn().mockReturnValue("encrypted:token:value"),
}));

import {
  revokeGoogleToken,
  GmailClient,
  GmailAuthError,
  GmailThreadNotFoundError,
} from "./gmail-client.js";
import { decrypt } from "./encryption.js";

const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const STOP_URL = "https://gmail.googleapis.com/gmail/v1/users/me/stop";

const mockFetch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(decrypt).mockReturnValue("plain-refresh-token");
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ─── revokeGoogleToken ────────────────────────────────────────────────────────

describe("revokeGoogleToken", () => {
  it("returns true when Google responds 200", async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200 });

    expect(await revokeGoogleToken("encrypted:token:value")).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      REVOKE_URL,
      expect.objectContaining({ method: "POST" })
    );
  });

  it("posts the token as form-encoded body", async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200 });

    await revokeGoogleToken("encrypted:token:value");

    const body = (mockFetch.mock.calls[0]?.[1] as RequestInit)?.body;
    expect(body?.toString()).toBe("token=plain-refresh-token");
  });

  it("returns true when Google responds 400 (token already invalid)", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 400 });

    expect(await revokeGoogleToken("encrypted:token:value")).toBe(true);
  });

  it("returns false when Google responds with a server error (500)", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });

    expect(await revokeGoogleToken("encrypted:token:value")).toBe(false);
  });

  it("returns false when the fetch throws (network error)", async () => {
    mockFetch.mockRejectedValue(new Error("network error"));

    expect(await revokeGoogleToken("encrypted:token:value")).toBe(false);
  });

  it("returns false when decryption fails", async () => {
    vi.mocked(decrypt).mockImplementationOnce(() => {
      throw new Error("bad key");
    });

    expect(await revokeGoogleToken("bad-token")).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns false when decryption returns an empty string", async () => {
    vi.mocked(decrypt).mockReturnValueOnce("");

    expect(await revokeGoogleToken("empty-token")).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ─── GmailClient.stopWatch ────────────────────────────────────────────────────

function makeTokenResponse() {
  return {
    ok: true,
    json: async () => ({
      access_token: "access-abc",
      expires_in: 3600,
      token_type: "Bearer",
    }),
  };
}

describe("GmailClient.stopWatch", () => {
  it("POSTs to the stop endpoint with a Bearer token", async () => {
    mockFetch
      .mockResolvedValueOnce(makeTokenResponse())
      .mockResolvedValueOnce({ ok: true, status: 200 });

    const client = new GmailClient("encrypted:refresh:token");
    await expect(client.stopWatch()).resolves.toBeUndefined();

    const [stopUrl, stopInit] = mockFetch.mock.calls[1] as [string, RequestInit];
    expect(stopUrl).toBe(STOP_URL);
    expect(stopInit.method).toBe("POST");
    expect((stopInit.headers as Record<string, string>)?.["Authorization"]).toBe(
      "Bearer access-abc"
    );
  });

  it("first refreshes the access token before calling the stop endpoint", async () => {
    mockFetch
      .mockResolvedValueOnce(makeTokenResponse())
      .mockResolvedValueOnce({ ok: true, status: 200 });

    const client = new GmailClient("encrypted:refresh:token");
    await client.stopWatch();

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect((mockFetch.mock.calls[0] as [string])[0]).toBe(TOKEN_URL);
    expect((mockFetch.mock.calls[1] as [string])[0]).toBe(STOP_URL);
  });

  it("throws when the stop endpoint responds non-200", async () => {
    mockFetch
      .mockResolvedValueOnce(makeTokenResponse())
      .mockResolvedValueOnce({ ok: false, status: 403 });

    const client = new GmailClient("encrypted:refresh:token");
    await expect(client.stopWatch()).rejects.toThrow("403");
  });
});

// ─── GmailClient.refreshAccessToken ───────────────────────────────────────────
// All refresh tokens are minted against the confidential Web client, so refresh
// always sends id + secret. invalid_grant / 401 (revoked or rejected) map to
// GmailAuthError, which the worker treats as a disconnect.

describe("GmailClient.refreshAccessToken", () => {
  function refreshBody(): URLSearchParams {
    const body = (mockFetch.mock.calls[0]?.[1] as RequestInit)?.body;
    return new URLSearchParams(body?.toString() ?? "");
  }

  it("refreshes with the confidential Web client (id + secret)", async () => {
    vi.stubEnv("AUTH_GOOGLE_ID", "web-client-id");
    vi.stubEnv("AUTH_GOOGLE_SECRET", "web-secret");
    mockFetch.mockResolvedValueOnce(makeTokenResponse());

    const client = new GmailClient("encrypted:refresh:token");
    await expect(client.refreshAccessToken()).resolves.toBe("access-abc");

    const params = refreshBody();
    expect(params.get("client_id")).toBe("web-client-id");
    expect(params.get("client_secret")).toBe("web-secret");
    expect(params.get("grant_type")).toBe("refresh_token");
  });

  it("throws GmailAuthError on invalid_grant", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: "invalid_grant" }),
    });

    const client = new GmailClient("encrypted:refresh:token");
    await expect(client.refreshAccessToken()).rejects.toThrow(GmailAuthError);
  });

  it("throws GmailAuthError on a 401 (e.g. unauthorized_client)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: "unauthorized_client" }),
    });

    const client = new GmailClient("encrypted:refresh:token");
    await expect(client.refreshAccessToken()).rejects.toThrow(GmailAuthError);
  });
});

// ─── GmailClient.listThreadsPage ──────────────────────────────────────────────

describe("GmailClient.listThreadsPage", () => {
  function listUrl(): URL {
    // calls[0] is the token refresh; calls[1] is the threads.list request.
    return new URL((mockFetch.mock.calls[1] as [string])[0]);
  }

  it("clamps a full-history scan (afterMs 0) to after:1, never the broken after:0", async () => {
    mockFetch
      .mockResolvedValueOnce(makeTokenResponse())
      .mockResolvedValueOnce({ ok: true, json: async () => ({ threads: [], resultSizeEstimate: 0 }) });

    const client = new GmailClient("encrypted:refresh:token");
    await client.listThreadsPage({ afterMs: 0, pageSize: 100 });

    // Gmail returns nothing for after:0, so a full-history scan must use after:1.
    expect(listUrl().searchParams.get("q")).toBe("after:1");
  });

  it("uses the real timestamp for a windowed scan", async () => {
    mockFetch
      .mockResolvedValueOnce(makeTokenResponse())
      .mockResolvedValueOnce({ ok: true, json: async () => ({ threads: [], resultSizeEstimate: 0 }) });

    const client = new GmailClient("encrypted:refresh:token");
    await client.listThreadsPage({ afterMs: 1_700_000_000_000, pageSize: 100 });

    expect(listUrl().searchParams.get("q")).toBe("after:1700000000");
  });
});

// ─── GmailClient.getThread — deleted-thread detection ─────────────────────────
// A thread-specific 404 is the ONLY definitive "deleted" signal and maps to the
// typed GmailThreadNotFoundError the sync/classify/backfill loops skip on. Every
// other status stays a generic error so callers treat it as transient and retry.

describe("GmailClient.getThread — not-found mapping", () => {
  it("throws GmailThreadNotFoundError on a 404 for the requested thread", async () => {
    mockFetch
      .mockResolvedValueOnce(makeTokenResponse())
      .mockResolvedValueOnce({ ok: false, status: 404 });

    const client = new GmailClient("encrypted:refresh:token");
    await expect(client.getThread("gone-thread")).rejects.toBeInstanceOf(
      GmailThreadNotFoundError
    );
  });

  it("throws a plain (transient) error on a 5xx, never the typed not-found", async () => {
    mockFetch
      .mockResolvedValueOnce(makeTokenResponse())
      .mockResolvedValueOnce({ ok: false, status: 503 });

    const client = new GmailClient("encrypted:refresh:token");
    const err = await client.getThread("t-1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(GmailThreadNotFoundError);
  });
});
