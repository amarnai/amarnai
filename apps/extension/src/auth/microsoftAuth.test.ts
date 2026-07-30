import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../config", () => ({
  MS_CLIENT_ID: "ms-client-id",
  API_BASE_URL: "http://localhost:3001",
  WEB_APP_URL: "http://localhost:3000",
}));

vi.mock("./writebackPolicy", () => ({
  isWritebackAvailable: vi.fn(),
  prefetchWritebackPolicy: vi.fn(),
}));

import { requestMicrosoftAuth, MicrosoftAuthCancelledError } from "./microsoftAuth";
import { isWritebackAvailable } from "./writebackPolicy";

const REDIRECT = "https://abcdefghijklmnop.chromiumapp.org/";

beforeEach(() => {
  vi.mocked(chrome.identity.getRedirectURL).mockReturnValue(REDIRECT);
  vi.mocked(isWritebackAvailable).mockResolvedValue(false);
});

describe("requestMicrosoftAuth", () => {
  it("builds a Microsoft code-flow URL and returns the parsed code + scope", async () => {
    vi.mocked(chrome.identity.launchWebAuthFlow).mockResolvedValue(
      `${REDIRECT}?code=ms-code-123&scope=Mail.Read%20offline_access%20User.Read`,
    );

    const result = await requestMicrosoftAuth();

    const call = vi.mocked(chrome.identity.launchWebAuthFlow).mock.calls[0]![0];
    const url = new URL(call.url);
    expect(url.origin + url.pathname).toBe(
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    );
    expect(url.searchParams.get("client_id")).toBe("ms-client-id");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT);
    expect(url.searchParams.get("scope")).toContain("Mail.Read");
    // offline_access is required for the API to receive a refresh token.
    expect(url.searchParams.get("scope")).toContain("offline_access");
    expect(call.interactive).toBe(true);

    expect(result.code).toBe("ms-code-123");
    expect(result.redirectUri).toBe(REDIRECT);
    expect(result.scope).toContain("Mail.Read");
  });

  it("adds both write scopes, keeping Mail.Read, when writeback is on", async () => {
    vi.mocked(isWritebackAvailable).mockResolvedValue(true);
    vi.mocked(chrome.identity.launchWebAuthFlow).mockResolvedValue(`${REDIRECT}?code=c`);

    await requestMicrosoftAuth();

    const calls = vi.mocked(chrome.identity.launchWebAuthFlow).mock.calls;
    const url = new URL(calls.at(-1)![0].url);
    expect(url.searchParams.get("scope")).toBe(
      "openid Mail.Read offline_access User.Read Mail.ReadWrite MailboxSettings.ReadWrite",
    );
    // Mail.ReadWrite does NOT replace Mail.Read: Microsoft refresh tokens are
    // scope-bound, so keeping it is what lets a declined or tenant-restricted
    // write consent still yield a working read-only connection.
    expect(url.searchParams.get("scope")).toContain("Mail.Read ");
  });

  it("stays read-only when writeback is off", async () => {
    vi.mocked(chrome.identity.launchWebAuthFlow).mockResolvedValue(`${REDIRECT}?code=c`);

    await requestMicrosoftAuth();

    const calls = vi.mocked(chrome.identity.launchWebAuthFlow).mock.calls;
    const url = new URL(calls.at(-1)![0].url);
    expect(url.searchParams.get("scope")).toBe("openid Mail.Read offline_access User.Read");
  });

  it("throws MicrosoftAuthCancelledError when the flow resolves without a URL", async () => {
    vi.mocked(chrome.identity.launchWebAuthFlow).mockResolvedValue(undefined as unknown as string);
    await expect(requestMicrosoftAuth()).rejects.toBeInstanceOf(MicrosoftAuthCancelledError);
  });

  it("throws MicrosoftAuthCancelledError when the redirect carries no code", async () => {
    vi.mocked(chrome.identity.launchWebAuthFlow).mockResolvedValue(`${REDIRECT}?error=access_denied`);
    await expect(requestMicrosoftAuth()).rejects.toBeInstanceOf(MicrosoftAuthCancelledError);
  });

  it("throws MicrosoftAuthCancelledError when launchWebAuthFlow rejects", async () => {
    vi.mocked(chrome.identity.launchWebAuthFlow).mockRejectedValue(new Error("user closed window"));
    await expect(requestMicrosoftAuth()).rejects.toBeInstanceOf(MicrosoftAuthCancelledError);
  });
});
