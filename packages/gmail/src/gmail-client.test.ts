import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("./encryption.js", () => ({
  decrypt: vi.fn().mockReturnValue("plain-refresh-token"),
  encrypt: vi.fn().mockReturnValue("encrypted:token:value"),
}));

import { revokeGoogleToken, GmailClient } from "./gmail-client.js";
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
