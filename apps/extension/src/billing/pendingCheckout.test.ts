import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resetChromeStorage } from "../test-setup";
import { setPendingCheckout, getPendingCheckout, clearPendingCheckout } from "./pendingCheckout";

beforeEach(() => {
  resetChromeStorage();
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("pendingCheckout", () => {
  it("round-trips a session id", async () => {
    await setPendingCheckout("cs_1");

    expect(await getPendingCheckout()).toBe("cs_1");
  });

  it("returns null when nothing is pending", async () => {
    expect(await getPendingCheckout()).toBeNull();
  });

  it("forgets a cleared checkout", async () => {
    await setPendingCheckout("cs_1");
    await clearPendingCheckout();

    expect(await getPendingCheckout()).toBeNull();
  });

  it("drops an abandoned checkout instead of retrying it forever", async () => {
    await setPendingCheckout("cs_1");

    // Two hours later: past the one-hour retention window.
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 2 * 60 * 60 * 1000);

    expect(await getPendingCheckout()).toBeNull();
    // The stale marker is removed, not just ignored.
    vi.useRealTimers();
    expect(await getPendingCheckout()).toBeNull();
  });

  it("ignores a corrupted marker", async () => {
    await chrome.storage.local.set({ "aziru.billing.pendingCheckout": "not json" });

    expect(await getPendingCheckout()).toBeNull();
  });
});
