import { describe, it, expect, beforeEach, vi } from "vitest";
import { claimFirstReveal } from "./firstReveal";
import { resetChromeStorage } from "../../test-setup";

describe("claimFirstReveal", () => {
  beforeEach(() => {
    resetChromeStorage();
  });

  it("claims the first call and refuses every later one", async () => {
    expect(await claimFirstReveal()).toBe(true);
    expect(await claimFirstReveal()).toBe(false);
    expect(await claimFirstReveal()).toBe(false);
  });

  // Unreadable storage must claim nothing: a read that keeps failing would
  // otherwise open the panel on every single load.
  it("claims nothing when storage is unreadable", async () => {
    vi.mocked(chrome.storage.local.get).mockRejectedValueOnce(new Error("gone"));
    expect(await claimFirstReveal()).toBe(false);
  });
});
