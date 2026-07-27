import { describe, it, expect, afterEach, vi } from "vitest";
import {
  startScheduler,
  OBSERVE_THROTTLE_MS,
  MAX_ATTEMPTS_PER_THREAD,
  type ThreadContext,
} from "./scheduler";

// The scheduler drives everything the user actually sees, and its failure mode is
// invisible (no widget, no error). These cover the transitions that matter.

afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
});

const THREAD_A: ThreadContext = { providerThreadId: "a", accountEmail: "ada@example.com" };
const THREAD_B: ThreadContext = { providerThreadId: "b", accountEmail: "ada@example.com" };

/** Drive one throttled mutation tick. */
async function tick() {
  document.body.appendChild(document.createElement("div"));
  await new Promise((r) => setTimeout(r, OBSERVE_THROTTLE_MS + 60));
}

describe("startScheduler", () => {
  it("handles the open thread once on start", () => {
    const onThread = vi.fn().mockReturnValue(true);
    const s = startScheduler({ detect: () => THREAD_A, onThread, onLeave: vi.fn() });
    expect(onThread).toHaveBeenCalledOnce();
    expect(onThread).toHaveBeenCalledWith(THREAD_A);
    s.stop();
  });

  it("does not re-handle a thread that was handled successfully", async () => {
    const onThread = vi.fn().mockReturnValue(true);
    const s = startScheduler({ detect: () => THREAD_A, onThread, onLeave: vi.fn() });
    await tick();
    await tick();
    expect(onThread).toHaveBeenCalledOnce();
    s.stop();
  });

  // The regression that made the widget never appear on a real Gmail load: the
  // content script runs at document_idle, before the conversation has painted, so
  // the first attempt fails. The scheduler used to latch the thread id anyway and
  // suppress every later attempt.
  it("retries a thread whose first attempt was not ready, then stops once it succeeds", async () => {
    const onThread = vi
      .fn()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
      .mockReturnValue(true);
    const s = startScheduler({ detect: () => THREAD_A, onThread, onLeave: vi.fn() });
    expect(onThread).toHaveBeenCalledTimes(1);

    await tick();
    expect(onThread).toHaveBeenCalledTimes(2);
    await tick();
    expect(onThread).toHaveBeenCalledTimes(3); // this one succeeds

    await tick();
    await tick();
    expect(onThread).toHaveBeenCalledTimes(3); // settled, no further attempts
    s.stop();
  });

  // Driven through check() rather than DOM ticks: this asserts the attempt cap,
  // and 25 throttled mutation ticks would just be 9s of real waiting.
  it("gives up after MAX_ATTEMPTS_PER_THREAD so an unrecognized page is not re-probed forever", () => {
    const onThread = vi.fn().mockReturnValue(false);
    const s = startScheduler({ detect: () => THREAD_A, onThread, onLeave: vi.fn() });
    for (let i = 0; i < MAX_ATTEMPTS_PER_THREAD + 5; i++) s.check();
    expect(onThread).toHaveBeenCalledTimes(MAX_ATTEMPTS_PER_THREAD);
    s.stop();
  });

  it("tears down and re-handles when the open thread changes", async () => {
    const onThread = vi.fn().mockReturnValue(true);
    const onLeave = vi.fn();
    let current: ThreadContext | null = THREAD_A;
    const s = startScheduler({ detect: () => current, onThread, onLeave });
    expect(onThread).toHaveBeenCalledTimes(1);

    current = THREAD_B;
    await tick();
    expect(onLeave).toHaveBeenCalledOnce();
    expect(onThread).toHaveBeenLastCalledWith(THREAD_B);
    s.stop();
  });

  it("tears down when the user returns to the list view", async () => {
    const onLeave = vi.fn();
    let current: ThreadContext | null = THREAD_A;
    const s = startScheduler({ detect: () => current, onThread: () => true, onLeave });

    current = null;
    await tick();
    expect(onLeave).toHaveBeenCalledOnce();
    s.stop();
  });

  // Re-entering the same thread after leaving must work — the attempt counter and
  // the handled flag both have to reset, or the second visit renders nothing.
  it("re-handles a thread re-opened after going back to the list", async () => {
    const onThread = vi.fn().mockReturnValue(true);
    let current: ThreadContext | null = THREAD_A;
    const s = startScheduler({ detect: () => current, onThread, onLeave: vi.fn() });
    expect(onThread).toHaveBeenCalledTimes(1);

    current = null;
    await tick();
    current = THREAD_A;
    await tick();
    expect(onThread).toHaveBeenCalledTimes(2);
    s.stop();
  });

  it("treats a throwing detect as no thread rather than propagating", () => {
    const onThread = vi.fn().mockReturnValue(true);
    const s = startScheduler({
      detect: () => {
        throw new Error("unfamiliar DOM");
      },
      onThread,
      onLeave: vi.fn(),
    });
    expect(onThread).not.toHaveBeenCalled();
    s.stop();
  });

  it("stops observing after stop()", async () => {
    const onThread = vi.fn().mockReturnValue(false);
    const s = startScheduler({ detect: () => THREAD_A, onThread, onLeave: vi.fn() });
    s.stop();
    await tick();
    expect(onThread).toHaveBeenCalledTimes(1); // only the synchronous initial check
  });
});
