import * as Kefir from "kefir";
import {
  describeReplyState,
  resolveDraftOutcome,
  TRANSIENT_MS,
  type ReplyButtonState,
} from "../core/replyState.js";
import type { GenerateDraftResponse } from "../core/messaging.js";

// The "Amarnai Reply" button inside Gmail's own reply compose.
//
// Deliberately written against the narrowest slice of InboxSDK's ComposeView it
// needs, so the whole state machine is testable with a plain fake. Nothing here
// touches the DOM or the SDK directly: attachReplyButton is handed a compose
// view and a way to ask the background for a draft, and does the rest.
//
// The states themselves, their labels, and the response-to-state mapping are in
// core/replyState.ts, shared with the OWA button. What is Gmail's own: the
// Kefir-stream plumbing InboxSDK's addButton wants, and insertion at the cursor.

/** The part of InboxSDK's ComposeView this feature uses. */
export type ComposeViewLike = {
  isInlineReplyForm(): boolean;
  isReply(): boolean;
  isForward(): boolean;
  getThreadID(): string;
  insertHTMLIntoBodyAtCursor(html: string): HTMLElement | null | undefined | unknown;
  /** InboxSDK removes the button when the descriptor stream emits null. */
  addButton(descriptor: Kefir.Observable<ButtonDescriptor | null, never>): unknown;
};

export type ButtonDescriptor = {
  title: string;
  tooltip: string;
  iconUrl?: string;
  enabled: boolean;
  type: "MODIFIER";
  orderHint: number;
  onClick: () => void;
};

export type ReplyButtonDeps = {
  /** The mailbox visible in the mail UI, for multi-login safety. Null if unknown. */
  getAccountEmail: () => string | null;
  /** Ask the background to generate. Never rejects; it answers with an outcome. */
  requestDraft: (accountEmail: string, providerThreadId: string) => Promise<GenerateDraftResponse>;
  /** Open the extension's own panel, where signing in actually happens. */
  openPanel: () => void;
  /** The workspace turned the feature off; the host tears down its other surfaces. */
  onDisabled?: () => void;
  iconUrl?: string;
};

export type ReplyButtonOptions = {
  /**
   * Generate immediately instead of waiting for a click — used when the compose
   * was opened by one of the injected entry points, where the user's click on
   * "Amarnai Reply" already WAS the request.
   */
  autoStart?: boolean;
  /**
   * A draft the opener already has, inserted as-is instead of generating one.
   * The injected panel opened this compose to place the draft it is showing;
   * asking the API again would risk a different text and a second charge
   * against the monthly allowance.
   */
  presetHtml?: string;
};

/**
 * The compose's thread id, or null. InboxSDK's getThreadID() THROWS for composes
 * without a thread rather than returning empty, so every caller goes through
 * this — a throw here would otherwise take down the SDK's compose handler.
 */
function threadIdOf(view: ComposeViewLike): string | null {
  try {
    const id = view.getThreadID();
    return id === "" ? null : id;
  } catch {
    return null;
  }
}

/**
 * Whether this compose is a reply we can draft into. Forwards are excluded: the
 * draft answers the thread's last message, which is not what a forward is for.
 * Brand-new composes have no thread to answer at all.
 */
export function isDraftableCompose(view: ComposeViewLike): boolean {
  if (view.isForward()) return false;
  if (!view.isReply() && !view.isInlineReplyForm()) return false;
  return threadIdOf(view) !== null;
}

/**
 * Add the button to one compose view. Returns a teardown that removes it — used
 * when the workspace turns the feature off mid-session.
 */
export function attachReplyButton(
  view: ComposeViewLike,
  deps: ReplyButtonDeps,
  opts: ReplyButtonOptions = {},
): () => void {
  if (!isDraftableCompose(view)) return () => {};

  // `current` is the source of truth; the stream is only how InboxSDK hears
  // about changes. It is lazy — nothing is delivered until addButton subscribes
  // — so the property seeds from `current` and no early emission is lost.
  let current: ReplyButtonState | null = { kind: "idle" };
  let push: ((next: ReplyButtonState | null) => void) | null = null;
  let inFlight = false;
  let transientTimer: ReturnType<typeof setTimeout> | undefined;
  // The container of the last insertion into THIS compose. A second click
  // replaces it rather than appending a duplicate (live UX bug 2026-07-27:
  // repeated clicks stacked copies of the draft in the body).
  let lastInserted: HTMLElement | null = null;

  const states = Kefir.stream<ReplyButtonState | null, never>((emitter) => {
    push = (next) => emitter.value(next);
    return () => {
      push = null;
    };
  });

  function emit(next: ReplyButtonState | null) {
    if (current === null) return; // already torn down
    current = next;
    push?.(next);
  }

  function emitTransient(next: ReplyButtonState) {
    emit(next);
    clearTimeout(transientTimer);
    transientTimer = setTimeout(() => emit({ kind: "idle" }), TRANSIENT_MS);
  }

  function teardown() {
    if (current === null) return;
    clearTimeout(transientTimer);
    current = null;
    push?.(null);
  }

  async function onClick() {
    // A second click while generating would start a second generation and
    // charge the user twice for one draft.
    if (inFlight) return;
    if (current?.kind === "signedOut") {
      deps.openPanel();
      return;
    }

    const accountEmail = deps.getAccountEmail();
    const providerThreadId = threadIdOf(view);
    if (!accountEmail || !providerThreadId) {
      emitTransient({ kind: "error" });
      return;
    }

    inFlight = true;
    clearTimeout(transientTimer);
    emit({ kind: "generating" });

    let response: GenerateDraftResponse;
    try {
      response = await deps.requestDraft(accountEmail, providerThreadId);
    } catch {
      // The background died or the channel closed; both read the same to a user.
      inFlight = false;
      emitTransient({ kind: "error" });
      return;
    }
    inFlight = false;

    const outcome = resolveDraftOutcome(response);
    if (outcome.kind === "state") {
      if (outcome.transient) emitTransient(outcome.state);
      else emit(outcome.state);
      return;
    }
    if (outcome.kind === "disabled") {
      // Remove the button, and tell the host so it can take down the entry
      // points that would reopen this dead end.
      teardown();
      deps.onDisabled?.();
      return;
    }

    insertHtml(outcome.html);
  }

  /**
   * Put draft HTML in the compose body. Replace, never append: clicking again
   * must not stack a second copy. If the user deleted the insertion, the node is
   * disconnected and this is a plain fresh insert.
   */
  function insertHtml(html: string) {
    if (lastInserted?.isConnected) lastInserted.remove();
    // One wrapper so a multi-paragraph draft is removable as a unit; inserted
    // at the cursor, so Gmail's quoted trail below survives untouched.
    const node = view.insertHTMLIntoBodyAtCursor(`<div>${html}</div>`);
    lastInserted = node instanceof HTMLElement ? node : null;
    emitTransient({ kind: "inserted" });
  }

  view.addButton(
    states.toProperty(() => current).map((s): ButtonDescriptor | null => {
      if (s === null) return null;
      const { label: title, tooltip, enabled } = describeReplyState(s);
      return {
        title,
        tooltip,
        ...(deps.iconUrl ? { iconUrl: deps.iconUrl } : {}),
        enabled,
        type: "MODIFIER",
        // Inside the compose tray so it reads as one of the compose's own
        // controls rather than something bolted on.
        orderHint: 10,
        onClick: () => void onClick(),
      };
    }),
  );

  // After addButton, so the "Drafting…"/"Inserted" state has a button to show on.
  // A draft that came with the opener goes in as-is; anything else is generated.
  if (opts.presetHtml !== undefined) insertHtml(opts.presetHtml);
  else if (opts.autoStart) void onClick();

  return teardown;
}
