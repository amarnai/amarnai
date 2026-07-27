import * as Kefir from "kefir";
import { REPLY_BUTTON_STRINGS, formatResetDate } from "../core/strings.js";
import { draftBodyToHtml } from "@amarnai/core/drafts";
import type { GenerateDraftResponse } from "../core/messaging.js";

// The "Amarnai Reply" button inside Gmail's own reply compose.
//
// Deliberately written against the narrowest slice of InboxSDK's ComposeView it
// needs, so the whole state machine is testable with a plain fake. Nothing here
// touches the DOM or the SDK directly: attachReplyButton is handed a compose
// view and a way to ask the background for a draft, and does the rest.

/** The part of InboxSDK's ComposeView this feature uses. */
export type ComposeViewLike = {
  isInlineReplyForm(): boolean;
  isReply(): boolean;
  isForward(): boolean;
  getThreadID(): string;
  insertHTMLIntoBodyAtCursor(html: string): unknown;
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
};

type State =
  | { kind: "idle" }
  | { kind: "generating" }
  | { kind: "notSorted" }
  | { kind: "error" }
  | { kind: "signedOut" }
  | { kind: "quota"; resetsAt: string };

/**
 * How long a transient outcome (error, not-sorted) stays on the button before it
 * returns to idle. Long enough to read, short enough that the button is ready
 * again by the time the user has fixed the cause.
 */
export const TRANSIENT_MS = 6_000;

function describe(state: State): { title: string; tooltip: string; enabled: boolean } {
  const S = REPLY_BUTTON_STRINGS;
  switch (state.kind) {
    case "generating":
      return { title: S.generating, tooltip: S.tooltips.generating, enabled: false };
    case "notSorted":
      return { title: S.notSorted, tooltip: S.tooltips.notSorted, enabled: true };
    case "error":
      return { title: S.error, tooltip: S.tooltips.error, enabled: true };
    case "signedOut":
      return { title: S.signedOut, tooltip: S.tooltips.signedOut, enabled: true };
    case "quota":
      return {
        title: S.quota,
        tooltip: S.tooltips.quota(formatResetDate(state.resetsAt)),
        // Nothing a click can do until the window resets.
        enabled: false,
      };
    case "idle":
      return { title: S.idle, tooltip: S.tooltips.idle, enabled: true };
  }
}

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
  let current: State | null = { kind: "idle" };
  let push: ((next: State | null) => void) | null = null;
  let inFlight = false;
  let transientTimer: ReturnType<typeof setTimeout> | undefined;

  const states = Kefir.stream<State | null, never>((emitter) => {
    push = (next) => emitter.value(next);
    return () => {
      push = null;
    };
  });

  function emit(next: State | null) {
    if (current === null) return; // already torn down
    current = next;
    push?.(next);
  }

  function emitTransient(next: State) {
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

    if (!response.ok) {
      switch (response.reason) {
        case "signedOut":
        case "noWorkspace":
          // Both mean "this mailbox is not usable from here"; the panel is where
          // signing in or connecting happens.
          emit({ kind: "signedOut" });
          return;
        case "injectionDisabled":
          // A settled answer, not a transient miss: remove the button rather
          // than inviting a retry that cannot succeed, and tell the host so it
          // can take down the entry points that would reopen this dead end.
          teardown();
          deps.onDisabled?.();
          return;
        default:
          emitTransient({ kind: "error" });
          return;
      }
    }

    const result = response.result;
    if (result.kind === "quota") {
      emit({ kind: "quota", resetsAt: result.resetsAt });
      return;
    }
    if (result.kind === "notSorted") {
      emitTransient({ kind: "notSorted" });
      return;
    }

    const html = draftBodyToHtml(result.body);
    if (html === "") {
      emitTransient({ kind: "error" });
      return;
    }
    // At the cursor, so Gmail's quoted trail below it survives untouched.
    view.insertHTMLIntoBodyAtCursor(html);
    emit({ kind: "idle" });
  }

  view.addButton(
    states.toProperty(() => current).map((s): ButtonDescriptor | null => {
      if (s === null) return null;
      const { title, tooltip, enabled } = describe(s);
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

  // After addButton, so the "Drafting…" state has a button to show on.
  if (opts.autoStart) void onClick();

  return teardown;
}
