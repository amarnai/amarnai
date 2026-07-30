import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../config", () => ({
  API_BASE_URL: "http://localhost:3001",
  GOOGLE_WEB_CLIENT_ID: "test-client-id",
  MS_CLIENT_ID: "ms-client-id",
  WEB_APP_URL: "http://localhost:3000",
}));

import { isWritebackAvailable, resetWritebackPolicyCache } from "./writebackPolicy";

function jsonOnce(body: unknown, ok = true): void {
  vi.mocked(global.fetch).mockResolvedValueOnce({
    ok,
    json: async () => body,
  } as Response);
}

beforeEach(() => {
  resetWritebackPolicyCache();
  global.fetch = vi.fn();
});

describe("isWritebackAvailable", () => {
  it("reports the deployment flag", async () => {
    jsonOnce({ writebackAvailable: true });
    await expect(isWritebackAvailable()).resolves.toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:3001/auth/mail-scope-policy",
      expect.objectContaining({ signal: expect.anything() }),
    );

    resetWritebackPolicyCache();
    jsonOnce({ writebackAvailable: false });
    await expect(isWritebackAvailable()).resolves.toBe(false);
  });

  // Every failure resolves FALSE, never true: asking for a write scope the
  // deployment has switched off trips Google's unverified-scope warning, and the
  // Outlook write scopes can hit tenant admin-consent limits that would turn a
  // working read-only sign-in into a hard failure.
  it("falls back to read-only on a non-200", async () => {
    jsonOnce({ writebackAvailable: true }, false);
    await expect(isWritebackAvailable()).resolves.toBe(false);
  });

  it("falls back to read-only when the request fails or aborts", async () => {
    vi.mocked(global.fetch).mockRejectedValueOnce(new Error("network down"));
    await expect(isWritebackAvailable()).resolves.toBe(false);
  });

  it("falls back to read-only on a body of the wrong shape", async () => {
    jsonOnce({});
    await expect(isWritebackAvailable()).resolves.toBe(false);

    resetWritebackPolicyCache();
    jsonOnce({ writebackAvailable: "yes" });
    await expect(isWritebackAvailable()).resolves.toBe(false);
  });

  it("memoizes a success so the sign-in click costs no request", async () => {
    jsonOnce({ writebackAvailable: true });
    await expect(isWritebackAvailable()).resolves.toBe(true);
    await expect(isWritebackAvailable()).resolves.toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("does NOT memoize a failure, so one blip cannot strand the session read-only", async () => {
    vi.mocked(global.fetch).mockRejectedValueOnce(new Error("blip"));
    await expect(isWritebackAvailable()).resolves.toBe(false);

    jsonOnce({ writebackAvailable: true });
    await expect(isWritebackAvailable()).resolves.toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
