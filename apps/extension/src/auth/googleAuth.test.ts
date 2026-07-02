import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../config", () => ({
  GOOGLE_WEB_CLIENT_ID: "test-client-id.apps.googleusercontent.com",
  API_BASE_URL: "http://localhost:3001",
  WEB_APP_URL: "http://localhost:3000",
}));

import { requestGoogleAuth, GoogleAuthCancelledError } from "./googleAuth";

const REDIRECT = "https://abcdefghijklmnop.chromiumapp.org/";

beforeEach(() => {
  vi.mocked(chrome.identity.getRedirectURL).mockReturnValue(REDIRECT);
});

describe("requestGoogleAuth", () => {
  it("builds an offline consent code-flow URL and returns the parsed code + scope", async () => {
    vi.mocked(chrome.identity.launchWebAuthFlow).mockResolvedValue(
      `${REDIRECT}?code=auth-code-123&scope=openid%20email%20https://www.googleapis.com/auth/gmail.readonly`,
    );

    const result = await requestGoogleAuth();

    const call = vi.mocked(chrome.identity.launchWebAuthFlow).mock.calls[0]![0];
    const url = new URL(call.url);
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe("test-client-id.apps.googleusercontent.com");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT);
    expect(url.searchParams.get("access_type")).toBe("offline");
    // Mandatory: without it Google may skip consent and omit the refresh token.
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("scope")).toContain("gmail.readonly");
    expect(call.interactive).toBe(true);

    expect(result.serverAuthCode).toBe("auth-code-123");
    expect(result.redirectUri).toBe(REDIRECT);
    expect(result.scope).toContain("gmail.readonly");
  });

  it("throws GoogleAuthCancelledError when the flow resolves without a URL", async () => {
    vi.mocked(chrome.identity.launchWebAuthFlow).mockResolvedValue(undefined as unknown as string);
    await expect(requestGoogleAuth()).rejects.toBeInstanceOf(GoogleAuthCancelledError);
  });

  it("throws GoogleAuthCancelledError when the redirect carries no code (access_denied)", async () => {
    vi.mocked(chrome.identity.launchWebAuthFlow).mockResolvedValue(`${REDIRECT}?error=access_denied`);
    await expect(requestGoogleAuth()).rejects.toBeInstanceOf(GoogleAuthCancelledError);
  });

  it("throws GoogleAuthCancelledError when launchWebAuthFlow rejects", async () => {
    vi.mocked(chrome.identity.launchWebAuthFlow).mockRejectedValue(new Error("user closed window"));
    await expect(requestGoogleAuth()).rejects.toBeInstanceOf(GoogleAuthCancelledError);
  });
});
