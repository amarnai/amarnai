import { describe, it, expect, beforeEach, type Mock } from "vitest";
import { ensureHostPermissions, hasHostPermissions } from "./permissions";

// @types/chrome overloads request/contains with a callback form that returns
// void, which confuses vi.mocked; assert the promise-returning shape we use.
type PermMock = Mock<(p: { origins?: string[] }) => Promise<boolean>>;
const request = chrome.permissions.request as unknown as PermMock;
const contains = chrome.permissions.contains as unknown as PermMock;

beforeEach(() => {
  request.mockReset();
  contains.mockReset();
});

describe("ensureHostPermissions", () => {
  it("returns true when the grant is accepted", async () => {
    request.mockResolvedValue(true);
    await expect(ensureHostPermissions()).resolves.toBe(true);
  });

  it("returns false when the grant is declined", async () => {
    request.mockResolvedValue(false);
    await expect(ensureHostPermissions()).resolves.toBe(false);
  });

  it("falls back to contains() when request() throws (no user gesture)", async () => {
    request.mockRejectedValue(new Error("not a user gesture"));
    contains.mockResolvedValue(true);
    await expect(ensureHostPermissions()).resolves.toBe(true);

    contains.mockResolvedValue(false);
    await expect(ensureHostPermissions()).resolves.toBe(false);
  });

  it("requests the API origin and Gmail", async () => {
    request.mockResolvedValue(true);
    await ensureHostPermissions();
    const origins = request.mock.calls[0]?.[0]?.origins ?? [];
    expect(origins).toContain("https://mail.google.com/*");
    // The API origin comes from VITE_API_URL (localhost:3001 in tests).
    expect(origins.some((o) => o.endsWith("/*") && o !== "https://mail.google.com/*")).toBe(true);
  });
});

describe("hasHostPermissions", () => {
  it("passes through contains() without prompting", async () => {
    contains.mockResolvedValue(true);
    await expect(hasHostPermissions()).resolves.toBe(true);
    expect(request).not.toHaveBeenCalled();
  });
});
