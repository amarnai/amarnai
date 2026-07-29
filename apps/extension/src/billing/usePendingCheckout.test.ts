import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { resetChromeStorage } from "../test-setup";
import { usePendingCheckout } from "./usePendingCheckout";
import { getPendingCheckout } from "./pendingCheckout";

// The panel must notice a completed checkout on its own. A Chrome side panel
// stays visible while the user moves between browser tabs, so returning from the
// Stripe tab may fire neither `focus` nor `visibilitychange` here; before this
// hook the plan stayed stale until the user happened to click into the panel.

vi.mock("./api", () => ({ confirmCheckout: vi.fn() }));

import { confirmCheckout } from "./api";

const POLL_MS = 5000;

beforeEach(() => {
  resetChromeStorage();
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Let queued promise callbacks run between fake-timer ticks. */
async function tick(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function render(onProvisioned = vi.fn()) {
  const view = renderHook(() => usePendingCheckout({ onProvisioned }));
  return { ...view, onProvisioned };
}

describe("usePendingCheckout — polling", () => {
  it("confirms a checkout that completes, without any focus event", async () => {
    vi.mocked(confirmCheckout).mockResolvedValue({
      ok: true,
      status: 200,
      data: { provisioned: true },
    } as never);

    const { result, onProvisioned } = render();
    await act(async () => {
      await result.current.start("cs_1");
    });

    expect(onProvisioned).not.toHaveBeenCalled();

    await tick(POLL_MS);

    expect(confirmCheckout).toHaveBeenCalledWith("cs_1");
    expect(onProvisioned).toHaveBeenCalledTimes(1);
  });

  it("keeps waiting while payment is still in progress", async () => {
    vi.mocked(confirmCheckout).mockResolvedValue({
      ok: true,
      status: 200,
      data: { pending: true },
    } as never);

    const { onProvisioned, result } = render();
    await act(async () => {
      await result.current.start("cs_1");
    });

    await tick(POLL_MS * 3);

    expect(vi.mocked(confirmCheckout).mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(onProvisioned).not.toHaveBeenCalled();
    // The marker survives so a later attempt can still land it.
    expect(await getPendingCheckout()).toBe("cs_1");
  });

  it("stops polling once the checkout resolves", async () => {
    vi.mocked(confirmCheckout).mockResolvedValue({
      ok: true,
      status: 200,
      data: { provisioned: true },
    } as never);

    const { result } = render();
    await act(async () => {
      await result.current.start("cs_1");
    });

    await tick(POLL_MS);
    const callsAtResolution = vi.mocked(confirmCheckout).mock.calls.length;

    await tick(POLL_MS * 5);

    expect(vi.mocked(confirmCheckout).mock.calls.length).toBe(callsAtResolution);
    expect(await getPendingCheckout()).toBeNull();
  });

  it("keeps watching when the confirm request itself fails", async () => {
    vi.mocked(confirmCheckout).mockRejectedValue(new Error("offline"));

    const { onProvisioned, result } = render();
    await act(async () => {
      await result.current.start("cs_1");
    });

    await tick(POLL_MS * 2);

    // A dead network says nothing about whether the payment went through.
    expect(await getPendingCheckout()).toBe("cs_1");
    expect(onProvisioned).not.toHaveBeenCalled();
  });

  it("gives up polling an abandoned checkout rather than hammering Stripe", async () => {
    vi.mocked(confirmCheckout).mockResolvedValue({
      ok: true,
      status: 200,
      data: { pending: true },
    } as never);

    const { result } = render();
    await act(async () => {
      await result.current.start("cs_1");
    });

    await tick(POLL_MS * 200);

    // Bounded at 60 attempts (five minutes); the focus trigger and the next
    // panel open still pick it up afterwards.
    expect(vi.mocked(confirmCheckout).mock.calls.length).toBeLessThanOrEqual(60);
  });
});

describe("usePendingCheckout — surviving a panel close", () => {
  it("picks a stored checkout back up on mount", async () => {
    vi.mocked(confirmCheckout).mockResolvedValue({
      ok: true,
      status: 200,
      data: { provisioned: true },
    } as never);

    // Started before the panel was closed.
    const first = render();
    await act(async () => {
      await first.result.current.start("cs_1");
    });
    first.unmount();
    vi.mocked(confirmCheckout).mockClear();

    // Reopened: the panel document is new, so the marker is the only trace.
    const { onProvisioned } = render();
    // Let the storage read settle so the poll is running before time advances.
    await act(async () => {});
    await tick(POLL_MS);

    expect(confirmCheckout).toHaveBeenCalledWith("cs_1");
    expect(onProvisioned).toHaveBeenCalled();
  });

  it("does nothing when no checkout is outstanding", async () => {
    render();
    await tick(POLL_MS * 3);

    expect(confirmCheckout).not.toHaveBeenCalled();
  });
});

describe("usePendingCheckout — confirmNow", () => {
  it("confirms immediately without waiting for the next poll", async () => {
    vi.mocked(confirmCheckout).mockResolvedValue({
      ok: true,
      status: 200,
      data: { provisioned: true },
    } as never);

    const { result, onProvisioned } = render();
    await act(async () => {
      await result.current.start("cs_1");
      await result.current.confirmNow();
    });

    expect(onProvisioned).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when nothing is pending", async () => {
    const { result } = render();
    await act(async () => {
      await result.current.confirmNow();
    });

    expect(confirmCheckout).not.toHaveBeenCalled();
  });
});

describe("usePendingCheckout — concurrent confirmation", () => {
  it("reports a landed upgrade once when a focus event races a poll tick", async () => {
    vi.mocked(confirmCheckout).mockResolvedValue({
      ok: true,
      status: 200,
      data: { provisioned: true },
    } as never);

    const { result, onProvisioned } = render();
    await act(async () => {
      await result.current.start("cs_1");
    });

    // Both triggers fire before either has cleared the marker.
    await act(async () => {
      await Promise.all([result.current.confirmNow(), result.current.confirmNow()]);
    });

    expect(onProvisioned).toHaveBeenCalledTimes(1);
    expect(vi.mocked(confirmCheckout).mock.calls.length).toBe(1);
  });
});

describe("usePendingCheckout — an expired session", () => {
  it("stops watching instead of retrying a session Stripe will never complete", async () => {
    vi.mocked(confirmCheckout).mockResolvedValue({
      ok: true,
      status: 200,
      data: { expired: true },
    } as never);

    const { result, onProvisioned } = render();
    await act(async () => {
      await result.current.start("cs_1");
    });

    await tick(POLL_MS);

    expect(await getPendingCheckout()).toBeNull();
    expect(onProvisioned).not.toHaveBeenCalled();

    // And no further polling.
    const calls = vi.mocked(confirmCheckout).mock.calls.length;
    await tick(POLL_MS * 3);
    expect(vi.mocked(confirmCheckout).mock.calls.length).toBe(calls);
  });
});
