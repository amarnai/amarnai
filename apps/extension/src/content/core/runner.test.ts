import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { ext } from "../../platform/ext";
import { runContentScript } from "./runner";
import { OBSERVE_THROTTLE_MS, type ThreadContext } from "./scheduler";
import type { ThreadSummaryResponse } from "./messaging";

// The runner is the only place that decides whether the mail page keeps being
// watched at all, so its failure modes are the expensive ones: a card over the
// wrong thread, or a workspace that switched the feature off still paying a
// background roundtrip on every thread open.

const THREAD_A: ThreadContext = { providerThreadId: "a", accountEmail: "ada@example.com" };

function anchoredDom(): void {
  document.body.innerHTML = `<div id="pane"><div id="list"></div></div>`;
}

/** Drive one throttled mutation tick, the scheduler's only re-check signal. */
async function tick() {
  document.body.appendChild(document.createElement("div"));
  await new Promise((r) => setTimeout(r, OBSERVE_THROTTLE_MS + 60));
}

const sendMessage = vi.mocked(ext.runtime.sendMessage);

beforeEach(() => {
  anchoredDom();
  sendMessage.mockReset();
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
});

function run(detect: () => ThreadContext | null) {
  runContentScript({
    detectThread: detect,
    findInjectionAnchor: () => document.getElementById("list"),
  });
}

describe("runContentScript", () => {
  it("asks the background for a summary when a thread opens", async () => {
    sendMessage.mockResolvedValue({
      ok: true,
      result: { kind: "summary", text: "Ada is confirming the date." },
    } satisfies ThreadSummaryResponse as never);

    run(() => THREAD_A);
    await tick();

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(document.querySelector("[data-amarnai-summary]")).not.toBeNull();
  });

  // The workspace kill-switch. A refusal is permanent for this page, unlike a
  // thread that simply has not synced yet, so the runner stops watching instead
  // of re-asking on every thread the user opens for the rest of the session.
  it("stops watching the page once the workspace refuses injection", async () => {
    sendMessage.mockResolvedValue({
      ok: false,
      reason: "injectionDisabled",
    } satisfies ThreadSummaryResponse as never);

    let current = THREAD_A;
    run(() => current);
    await tick();

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(document.querySelector("[data-amarnai-summary]")).toBeNull();

    // Opening a different thread must not produce a second request.
    current = { providerThreadId: "b", accountEmail: "ada@example.com" };
    await tick();
    await tick();

    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it("keeps watching after a transient miss so a later thread still resolves", async () => {
    sendMessage.mockResolvedValue({
      ok: false,
      reason: "noThread",
    } satisfies ThreadSummaryResponse as never);

    let current = THREAD_A;
    run(() => current);
    await tick();
    expect(sendMessage).toHaveBeenCalledTimes(1);

    current = { providerThreadId: "b", accountEmail: "ada@example.com" };
    await tick();

    expect(sendMessage).toHaveBeenCalledTimes(2);
  });
});
