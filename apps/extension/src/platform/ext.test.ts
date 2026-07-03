import { describe, it, expect, afterEach, vi } from "vitest";

// The shim reads the globals at import time, so each case resets modules and
// re-imports after arranging the globals.
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("ext", () => {
  it("prefers the Firefox `browser` global when present", async () => {
    const fakeBrowser = { storage: {} };
    vi.stubGlobal("browser", fakeBrowser);
    vi.resetModules();
    const { ext } = await import("./ext");
    expect(ext).toBe(fakeBrowser);
  });

  it("falls back to `chrome` when there is no `browser` (Chrome / jsdom)", async () => {
    // No `browser` global here — test-setup only defines `chrome`.
    vi.resetModules();
    const { ext } = await import("./ext");
    expect(ext).toBe(globalThis.chrome);
  });
});
