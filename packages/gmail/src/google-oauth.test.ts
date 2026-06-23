import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { exchangeServerAuthCode, GmailApiError } from "./google-oauth.js";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const mockFetch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mockFetch);
  vi.stubEnv("AUTH_GOOGLE_ID", "web-client-id");
  vi.stubEnv("AUTH_GOOGLE_SECRET", "web-secret");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function tokenSuccess() {
  return {
    ok: true,
    json: async () => ({
      access_token: "at",
      refresh_token: "rt",
      scope: "openid email https://www.googleapis.com/auth/gmail.readonly",
      expires_in: 3600,
    }),
  };
}

function body(): URLSearchParams {
  const raw = (mockFetch.mock.calls[0]?.[1] as RequestInit)?.body;
  return new URLSearchParams(raw?.toString() ?? "");
}

describe("exchangeServerAuthCode", () => {
  it("redeems the code against the Web client with an empty redirect and no PKCE verifier", async () => {
    mockFetch.mockResolvedValueOnce(tokenSuccess());

    const tokens = await exchangeServerAuthCode("auth-code-123");

    expect(mockFetch).toHaveBeenCalledWith(TOKEN_URL, expect.objectContaining({ method: "POST" }));
    const params = body();
    expect(params.get("code")).toBe("auth-code-123");
    expect(params.get("client_id")).toBe("web-client-id");
    expect(params.get("client_secret")).toBe("web-secret");
    expect(params.get("grant_type")).toBe("authorization_code");
    expect(params.get("redirect_uri")).toBe("");
    expect(params.has("code_verifier")).toBe(false);

    expect(tokens.accessToken).toBe("at");
    expect(tokens.refreshToken).toBe("rt");
  });

  it("throws GmailApiError when Google rejects the code", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: "invalid_grant" }),
    });

    await expect(exchangeServerAuthCode("expired")).rejects.toBeInstanceOf(GmailApiError);
  });

  it("throws when Google omits the refresh token", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: "at", scope: "s", expires_in: 3600 }),
    });

    await expect(exchangeServerAuthCode("no-offline")).rejects.toThrow(/refresh_token/);
  });
});
