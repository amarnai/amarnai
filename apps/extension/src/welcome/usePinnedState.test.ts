import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePinnedState } from "./usePinnedState";

// The shared chrome stub has no action.getUserSettings; each test installs the
// shape it needs and puts it back afterwards.
const action = chrome.action as unknown as Record<string, unknown>;

function stubUserSettings(impl: () => Promise<{ isOnToolbar: boolean }>) {
  action["getUserSettings"] = vi.fn(impl);
}

function callCount(): number {
  return (chrome.action.getUserSettings as ReturnType<typeof vi.fn>).mock.calls.length;
}

// Advance the poll clock and let the hook's awaits settle inside act(), so the
// state it sets is applied before the assertion reads it. Testing Library's
// waitFor is unusable here: it deadlocks against fake timers.
async function tick(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  delete action["getUserSettings"];
});

describe("usePinnedState", () => {
  it("stays unknown when the browser has no getUserSettings (Firefox)", async () => {
    const { result } = renderHook(() => usePinnedState());

    await tick(5000);
    expect(result.current).toBe("unknown");
  });

  it("reports pinned, then stops polling", async () => {
    stubUserSettings(async () => ({ isOnToolbar: true }));
    const { result } = renderHook(() => usePinnedState());

    await tick();
    expect(result.current).toBe("pinned");

    // Pinned is terminal: a step that could un-check itself reads as a glitch.
    await tick(5000);
    expect(callCount()).toBe(1);
  });

  it("flips to pinned on the poll after the user pins", async () => {
    let isOnToolbar = false;
    stubUserSettings(async () => ({ isOnToolbar }));
    const { result } = renderHook(() => usePinnedState());

    await tick();
    expect(result.current).toBe("unpinned");

    isOnToolbar = true;
    await tick(1000);
    expect(result.current).toBe("pinned");
  });

  it("falls back to unknown when the call rejects", async () => {
    stubUserSettings(async () => {
      throw new Error("unavailable");
    });
    const { result } = renderHook(() => usePinnedState());

    await tick(2000);
    expect(result.current).toBe("unknown");
    expect(callCount()).toBe(1);
  });

  it("skips the check while the tab is in the background", async () => {
    stubUserSettings(async () => ({ isOnToolbar: false }));
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);

    renderHook(() => usePinnedState());
    await tick(3000);
    expect(callCount()).toBe(0);

    hidden.mockReturnValue(false);
    await tick(1000);
    expect(callCount()).toBeGreaterThan(0);
    hidden.mockRestore();
  });

  it("stops polling after unmount", async () => {
    stubUserSettings(async () => ({ isOnToolbar: false }));
    const { unmount } = renderHook(() => usePinnedState());

    await tick();
    const before = callCount();
    expect(before).toBeGreaterThan(0);

    unmount();
    await tick(5000);
    expect(callCount()).toBe(before);
  });
});
