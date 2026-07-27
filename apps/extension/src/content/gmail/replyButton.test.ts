import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type * as Kefir from "kefir";
import {
  attachReplyButton,
  isDraftableCompose,
  TRANSIENT_MS,
  type ButtonDescriptor,
  type ComposeViewLike,
} from "./replyButton";
import { REPLY_BUTTON_STRINGS } from "../core/strings";
import type { GenerateDraftResponse } from "../core/messaging";

// A stand-in for InboxSDK's ComposeView. Subscribes to the descriptor stream the
// way the SDK does, and records what the button would look like at each step.
function makeComposeView(overrides: Partial<ComposeViewLike> = {}) {
  const rendered: (ButtonDescriptor | null)[] = [];
  const inserted: string[] = [];

  const view: ComposeViewLike = {
    isInlineReplyForm: () => true,
    isReply: () => true,
    isForward: () => false,
    getThreadID: () => "18f0abc",
    insertHTMLIntoBodyAtCursor: (html: string) => {
      inserted.push(html);
      return null;
    },
    addButton: (descriptor: Kefir.Observable<ButtonDescriptor | null, never>) => {
      descriptor.observe({ value: (d) => rendered.push(d) });
      return null;
    },
    ...overrides,
  };

  return {
    view,
    rendered,
    inserted,
    latest: () => rendered[rendered.length - 1],
    click: () => rendered[rendered.length - 1]?.onClick(),
  };
}

const DRAFT_OK: GenerateDraftResponse = {
  ok: true,
  result: { kind: "draft", draftId: "d1", body: "Thursday works." },
};

function makeDeps(response: GenerateDraftResponse = DRAFT_OK) {
  const requestDraft = vi.fn<
    (accountEmail: string, providerThreadId: string) => Promise<GenerateDraftResponse>
  >().mockResolvedValue(response);
  const openPanel = vi.fn();
  const deps: import("./replyButton").ReplyButtonDeps = {
    getAccountEmail: () => "ada@example.com",
    requestDraft,
    openPanel,
  };
  return { requestDraft, openPanel, deps };
}

/** Let the click's promise chain settle without advancing timers. */
const settle = () => Promise.resolve().then(() => Promise.resolve());

describe("isDraftableCompose", () => {
  it("accepts an inline reply", () => {
    expect(isDraftableCompose(makeComposeView().view)).toBe(true);
  });

  it("accepts a popped-out reply that is not inline", () => {
    const { view } = makeComposeView({ isInlineReplyForm: () => false, isReply: () => true });
    expect(isDraftableCompose(view)).toBe(true);
  });

  it("rejects a forward — the draft answers the thread, which a forward is not", () => {
    const { view } = makeComposeView({ isForward: () => true });
    expect(isDraftableCompose(view)).toBe(false);
  });

  it("rejects a brand-new compose with no thread to answer", () => {
    const { view } = makeComposeView({
      isReply: () => false,
      isInlineReplyForm: () => false,
      getThreadID: () => "",
    });
    expect(isDraftableCompose(view)).toBe(false);
  });

  it("rejects a reply whose thread id is not resolvable", () => {
    const { view } = makeComposeView({ getThreadID: () => "" });
    expect(isDraftableCompose(view)).toBe(false);
  });
});

describe("attachReplyButton", () => {
  it("adds no button at all to a compose it cannot draft into", () => {
    const compose = makeComposeView({ isForward: () => true });
    attachReplyButton(compose.view, makeDeps().deps);
    expect(compose.rendered).toHaveLength(0);
  });

  it("starts idle and enabled", () => {
    const compose = makeComposeView();
    attachReplyButton(compose.view, makeDeps().deps);
    expect(compose.latest()).toMatchObject({
      title: REPLY_BUTTON_STRINGS.idle,
      enabled: true,
    });
  });

  it("inserts the generated draft as HTML at the cursor", async () => {
    const compose = makeComposeView();
    attachReplyButton(compose.view, makeDeps().deps);

    compose.click();
    await settle();

    expect(compose.inserted).toEqual(["<p>Thursday works.</p>"]);
    expect(compose.latest()).toMatchObject({ title: REPLY_BUTTON_STRINGS.idle });
  });

  it("sends the visible mailbox and the compose's thread id", async () => {
    const compose = makeComposeView();
    const { requestDraft, deps } = makeDeps();
    attachReplyButton(compose.view, deps);

    compose.click();
    await settle();

    expect(requestDraft).toHaveBeenCalledWith("ada@example.com", "18f0abc");
  });

  it("shows a disabled drafting state while the request is in flight", async () => {
    let release: (r: GenerateDraftResponse) => void = () => {};
    const compose = makeComposeView();
    const { deps } = makeDeps();
    deps.requestDraft = vi.fn(
      () => new Promise<GenerateDraftResponse>((resolve) => (release = resolve)),
    );
    attachReplyButton(compose.view, deps);

    compose.click();
    expect(compose.latest()).toMatchObject({
      title: REPLY_BUTTON_STRINGS.generating,
      enabled: false,
    });

    release(DRAFT_OK);
    await settle();
    expect(compose.latest()).toMatchObject({ title: REPLY_BUTTON_STRINGS.idle });
  });

  it("ignores a second click while generating, so one draft is never charged twice", async () => {
    const compose = makeComposeView();
    const { deps } = makeDeps();
    deps.requestDraft = vi.fn(() => new Promise<GenerateDraftResponse>(() => {}));
    attachReplyButton(compose.view, deps);

    compose.click();
    compose.click();
    compose.click();
    await settle();

    expect(deps.requestDraft).toHaveBeenCalledTimes(1);
  });

  it("disables the button on a quota refusal and names the reset date", async () => {
    const compose = makeComposeView();
    const { deps } = makeDeps({
      ok: true,
      result: { kind: "quota", used: 3, limit: 3, resetsAt: "2026-08-01T00:00:00Z" },
    });
    attachReplyButton(compose.view, deps);

    compose.click();
    await settle();

    expect(compose.latest()).toMatchObject({
      title: REPLY_BUTTON_STRINGS.quota,
      enabled: false,
    });
    expect(compose.latest()?.tooltip).toContain("Aug 1");
  });

  it("points a signed-out user at the panel rather than authenticating in Gmail", async () => {
    const compose = makeComposeView();
    const { openPanel, deps } = makeDeps({ ok: false, reason: "signedOut" });
    attachReplyButton(compose.view, deps);

    compose.click();
    await settle();
    expect(compose.latest()).toMatchObject({
      title: REPLY_BUTTON_STRINGS.signedOut,
      enabled: true,
    });

    // The next click opens the panel instead of retrying the request.
    compose.click();
    await settle();
    expect(openPanel).toHaveBeenCalledOnce();
    expect(deps.requestDraft).toHaveBeenCalledOnce();
  });

  it("treats an unusable mailbox the same as signed out", async () => {
    const compose = makeComposeView();
    const { deps } = makeDeps({ ok: false, reason: "noWorkspace" });
    attachReplyButton(compose.view, deps);

    compose.click();
    await settle();
    expect(compose.latest()).toMatchObject({ title: REPLY_BUTTON_STRINGS.signedOut });
  });

  it("removes the button when the workspace has turned the feature off", async () => {
    const compose = makeComposeView();
    const { deps } = makeDeps({ ok: false, reason: "injectionDisabled" });
    attachReplyButton(compose.view, deps);

    compose.click();
    await settle();

    // null is how InboxSDK is told to drop the button — not a retry-able state.
    expect(compose.latest()).toBeNull();
  });

  it("errors when the mailbox cannot be read, without calling the background", async () => {
    const compose = makeComposeView();
    const { deps } = makeDeps();
    deps.getAccountEmail = () => null;
    attachReplyButton(compose.view, deps);

    compose.click();
    await settle();

    expect(deps.requestDraft).not.toHaveBeenCalled();
    expect(compose.latest()).toMatchObject({ title: REPLY_BUTTON_STRINGS.error });
  });

  it("errors rather than inserting when the draft body is empty", async () => {
    const compose = makeComposeView();
    const { deps } = makeDeps({
      ok: true,
      result: { kind: "draft", draftId: "d1", body: "   " },
    });
    attachReplyButton(compose.view, deps);

    compose.click();
    await settle();

    expect(compose.inserted).toHaveLength(0);
    expect(compose.latest()).toMatchObject({ title: REPLY_BUTTON_STRINGS.error });
  });

  it("errors when the message channel itself fails", async () => {
    const compose = makeComposeView();
    const { deps } = makeDeps();
    deps.requestDraft = vi.fn().mockRejectedValue(new Error("channel closed"));
    attachReplyButton(compose.view, deps);

    compose.click();
    await settle();

    expect(compose.latest()).toMatchObject({ title: REPLY_BUTTON_STRINGS.error });
  });

  it("teardown removes the button", () => {
    const compose = makeComposeView();
    const detach = attachReplyButton(compose.view, makeDeps().deps);

    detach();

    expect(compose.latest()).toBeNull();
  });

  it("autoStart generates without a click — the entry-point click already asked", async () => {
    const compose = makeComposeView();
    const { deps } = makeDeps();
    attachReplyButton(compose.view, deps, { autoStart: true });

    await settle();

    expect(deps.requestDraft).toHaveBeenCalledOnce();
    expect(compose.inserted).toEqual(["<p>Thursday works.</p>"]);
  });

  it("autoStart still respects a non-draftable compose", async () => {
    const compose = makeComposeView({ isForward: () => true });
    const { deps } = makeDeps();
    attachReplyButton(compose.view, deps, { autoStart: true });

    await settle();
    expect(deps.requestDraft).not.toHaveBeenCalled();
  });

  it("tells the host when the workspace has the feature off, so entry points die too", async () => {
    const compose = makeComposeView();
    const { deps } = makeDeps({ ok: false, reason: "injectionDisabled" });
    const onDisabled = vi.fn();
    deps.onDisabled = onDisabled;
    attachReplyButton(compose.view, deps);

    compose.click();
    await settle();

    expect(compose.latest()).toBeNull();
    expect(onDisabled).toHaveBeenCalledOnce();
  });
});

describe("attachReplyButton transient states", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows 'still sorting' and returns to idle so the user can retry", async () => {
    const compose = makeComposeView();
    const { deps } = makeDeps({ ok: true, result: { kind: "notSorted" } });
    attachReplyButton(compose.view, deps);

    compose.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(compose.latest()).toMatchObject({
      title: REPLY_BUTTON_STRINGS.notSorted,
      // Enabled: classification usually lands within seconds, so a retry is the
      // right next action.
      enabled: true,
    });

    await vi.advanceTimersByTimeAsync(TRANSIENT_MS);
    expect(compose.latest()).toMatchObject({ title: REPLY_BUTTON_STRINGS.idle });
  });

  it("returns an errored button to idle so a retry is possible", async () => {
    const compose = makeComposeView();
    const { deps } = makeDeps({ ok: false, reason: "error" });
    attachReplyButton(compose.view, deps);

    compose.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(compose.latest()).toMatchObject({ title: REPLY_BUTTON_STRINGS.error });

    await vi.advanceTimersByTimeAsync(TRANSIENT_MS);
    expect(compose.latest()).toMatchObject({ title: REPLY_BUTTON_STRINGS.idle });
  });

  it("does not revert to idle after teardown", async () => {
    const compose = makeComposeView();
    const { deps } = makeDeps({ ok: false, reason: "error" });
    const detach = attachReplyButton(compose.view, deps);

    compose.click();
    await vi.advanceTimersByTimeAsync(0);
    detach();

    await vi.advanceTimersByTimeAsync(TRANSIENT_MS * 2);
    expect(compose.latest()).toBeNull();
  });
});
