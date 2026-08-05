import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { ext } from "../../platform/ext";
import { runContentScript, type ProviderAdapter } from "./runner";
import { OBSERVE_THROTTLE_MS, type ThreadContext } from "./scheduler";
import {
  COMMENT_META_MESSAGE,
  THREAD_SUMMARY_MESSAGE,
  type CommentMetaResponse,
  type ThreadSummaryResponse,
} from "./messaging";

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

// The comment bubble on the card. The count request rides in parallel with the
// summary and only ever decorates: a failed or missing count changes nothing,
// and the bubble only renders while its target panel is live.
describe("runContentScript — comment bubble", () => {
  const SUMMARY: ThreadSummaryResponse = {
    ok: true,
    result: { kind: "summary", text: "Ada is confirming the date." },
  };
  const SNIPPET: ThreadSummaryResponse = { ok: true, result: { kind: "snippet" } };
  const META: CommentMetaResponse = { ok: true, meta: { total: 3, unread: 1 } };

  function answer(summary: ThreadSummaryResponse, meta: CommentMetaResponse | undefined) {
    sendMessage.mockImplementation((async (message: { type: string }) => {
      if (message.type === THREAD_SUMMARY_MESSAGE) return summary;
      if (message.type === COMMENT_META_MESSAGE) return meta;
      return undefined;
    }) as never);
  }

  function runWithPanel(opts: Partial<ProviderAdapter> = {}) {
    const onOpenComments = vi.fn();
    runContentScript({
      detectThread: () => THREAD_A,
      findInjectionAnchor: () => document.getElementById("list"),
      onOpenComments,
      isCommentsTargetLive: () => true,
      ...opts,
    });
    return { onOpenComments };
  }

  function bubble(): HTMLButtonElement | null {
    const host = document.querySelector("[data-amarnai-summary]");
    return host?.shadowRoot?.querySelector<HTMLButtonElement>(".comments") ?? null;
  }

  it("merges a count into the summary card and opens comments on click", async () => {
    answer(SUMMARY, META);
    const { onOpenComments } = runWithPanel();
    await tick();

    expect(sendMessage).toHaveBeenCalledTimes(2);
    const b = bubble();
    expect(b).not.toBeNull();
    expect(b!.textContent).toContain("3");
    expect(b!.classList.contains("unread")).toBe(true);
    b!.click();
    expect(onOpenComments).toHaveBeenCalledTimes(1);
  });

  it("renders the card without a bubble when the count request fails", async () => {
    answer(SUMMARY, { ok: false, reason: "noThread" });
    runWithPanel();
    await tick();

    expect(document.querySelector("[data-amarnai-summary]")).not.toBeNull();
    expect(bubble()).toBeNull();
  });

  it("renders no bubble when the target panel is not live", async () => {
    answer(SUMMARY, META);
    runWithPanel({ isCommentsTargetLive: () => false });
    await tick();

    expect(document.querySelector("[data-amarnai-summary]")).not.toBeNull();
    expect(bubble()).toBeNull();
  });

  it("never requests the count without an onOpenComments target", async () => {
    sendMessage.mockResolvedValue(SUMMARY as never);
    run(() => THREAD_A);
    await tick();

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(bubble()).toBeNull();
  });

  it("mounts the one-line comments strip on a snippet thread with discussion", async () => {
    answer(SNIPPET, META);
    runWithPanel();
    await tick();

    const host = document.querySelector("[data-amarnai-summary]");
    expect(host).not.toBeNull();
    expect(host!.shadowRoot!.querySelector(".card")!.classList.contains("row")).toBe(true);
    expect(bubble()!.textContent).toContain("3");
  });

  it("renders nothing on a snippet thread without comments", async () => {
    answer(SNIPPET, { ok: true, meta: { total: 0, unread: 0 } });
    runWithPanel();
    await tick();

    expect(document.querySelector("[data-amarnai-summary]")).toBeNull();
  });

  it("re-fetches and re-renders the count on the controller's refreshComments()", async () => {
    let meta: CommentMetaResponse = { ok: true, meta: { total: 1, unread: 0 } };
    sendMessage.mockImplementation((async (message: { type: string }) => {
      if (message.type === THREAD_SUMMARY_MESSAGE) return SUMMARY;
      if (message.type === COMMENT_META_MESSAGE) return meta;
      return undefined;
    }) as never);

    const onOpenComments = vi.fn();
    const controller = runContentScript({
      detectThread: () => THREAD_A,
      findInjectionAnchor: () => document.getElementById("list"),
      onOpenComments,
      isCommentsTargetLive: () => true,
    });
    await tick();
    expect(bubble()!.textContent).toContain("1");

    // The panel just reported a change (a comment was posted there): the nudge
    // re-fetches through the same background path and updates in place.
    meta = { ok: true, meta: { total: 2, unread: 0 } };
    controller.refreshComments();
    await new Promise((r) => setTimeout(r, 0));

    expect(bubble()!.textContent).toContain("2");
  });

  it("applies a count that lands after the summary, without remounting", async () => {
    let resolveMeta!: (r: CommentMetaResponse) => void;
    const slowMeta = new Promise<CommentMetaResponse>((r) => {
      resolveMeta = r;
    });
    sendMessage.mockImplementation((async (message: { type: string }) => {
      if (message.type === THREAD_SUMMARY_MESSAGE) return SUMMARY;
      if (message.type === COMMENT_META_MESSAGE) return slowMeta;
      return undefined;
    }) as never);

    runWithPanel();
    await tick();
    expect(bubble()).toBeNull();
    const hostBefore = document.querySelector("[data-amarnai-summary]");

    resolveMeta(META);
    await new Promise((r) => setTimeout(r, 0));

    expect(document.querySelector("[data-amarnai-summary]")).toBe(hostBefore);
    expect(bubble()!.textContent).toContain("3");
  });
});
