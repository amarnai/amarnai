import { debugLog } from "../core/debug.js";
import { REPLY_BUTTON_STRINGS } from "../core/strings.js";
import { requestDraftFromBackground } from "../core/draftRequest.js";
import { createReplyIcon, REPLY_ICON_CSS } from "../core/replyIcon.js";
import { OPEN_PANEL_MESSAGE } from "../core/messaging.js";
import { startDomTicker } from "../core/scheduler.js";
import {
  describeReplyState,
  resolveDraftOutcome,
  TRANSIENT_MS,
  type ReplyButtonState,
} from "../core/replyState.js";
import { detectOutlookThread } from "./detectThread.js";

// The "Amarnai Reply" button in OWA's own reading pane (product decision
// 2026-07-27: Outlook gets the same injected surfaces as Gmail; the Office
// add-in stays the surface for desktop Outlook, where content scripts cannot
// go). There is no InboxSDK for OWA, so both halves are hand-rolled:
//
//   - Placement: OWA renders a row of [Reply] [Forward] pill buttons at the end
//     of the last expanded message (verified on a live outlook.live.com
//     screenshot, 2026-07-27). Identified structurally, not by class or label:
//     the LAST cluster of >=2 sibling buttons inside the conversation pane.
//     OWA's classes are build-hashed and its labels localized; sibling-button
//     structure is neither.
//   - Flow: generate FIRST (the button shows the state machine), then open the
//     reply by clicking the cluster's first button — in that row Reply comes
//     first — and insert once the compose editor exists. If the reply is
//     already open, insertion is immediate; if OWA's row surprises us, the
//     "Click Reply to insert" state leaves the user one native click away.
//   - Insertion target: [contenteditable="true"][role="textbox"] — the inline
//     compose editor, an accessibility contract OWA cannot hash or localize.

export const OWA_BUTTON_ATTRIBUTE = "data-amarnai-owa-reply";

/** How long a generated draft waits for a compose editor before it lapses. */
const PENDING_TTL_MS = 90_000;

let disabled = false;
let state: ReplyButtonState = { kind: "idle" };
let currentThreadId: string | null = null;
let pending: { threadId: string; html: string; at: number } | null = null;
let lastInserted: HTMLElement | null = null;
let transientTimer: ReturnType<typeof setTimeout> | undefined;

let now = () => Date.now();

/** Reset all module state (tests). */
export function resetOutlookReplyButton(clock?: () => number): void {
  disabled = false;
  state = { kind: "idle" };
  currentThreadId = null;
  pending = null;
  lastInserted = null;
  clearTimeout(transientTimer);
  if (clock) now = clock;
}

function render(doc: Document): void {
  const button = doc.querySelector<HTMLElement>(`[${OWA_BUTTON_ATTRIBUTE}]`);
  if (!button) return;
  const { label, tooltip, enabled } = describeReplyState(state);
  const text = button.querySelector<HTMLElement>("span");
  if (text) text.textContent = label;
  // OWA has no attribute-driven tooltip system like Gmail's; title is the
  // dependable cross-surface fallback.
  button.title = tooltip;
  button.setAttribute("aria-label", tooltip);
  button.setAttribute("aria-disabled", enabled ? "false" : "true");
  button.style.opacity = enabled ? "1" : "0.6";
  button.style.cursor = enabled ? "pointer" : "default";
}

function setState(doc: Document, next: ReplyButtonState): void {
  state = next;
  clearTimeout(transientTimer);
  render(doc);
}

function setTransient(doc: Document, next: ReplyButtonState): void {
  setState(doc, next);
  transientTimer = setTimeout(() => {
    state = { kind: "idle" };
    render(doc);
  }, TRANSIENT_MS);
}

/**
 * The last cluster of sibling buttons in the MESSAGE LIST — the [Reply]
 * [Forward] row at the end of the last expanded message. Returns the cluster
 * container and its first button (Reply).
 *
 * Scoped to `.customScrollBar` (the messages block) rather than the whole
 * reading pane, and that is load-bearing: the pane also holds the subject
 * header, whose category chip contributes a little button cluster of its own.
 * On a COLD LOAD the messages have not rendered while that header has — so a
 * pane-wide scan finds the header first and pins the button there for the life
 * of the page (live bug 2026-07-28: right placement when navigating, wrong one
 * after a refresh). detectThread.ts documents the same trap for the summary
 * anchor. Returning null until the real row exists keeps the observer retrying,
 * which is what we want.
 */
export function findReplyCluster(
  doc: Document,
): { container: HTMLElement; nativeReply: HTMLElement } | null {
  const pane = doc.getElementById("ConversationReadingPaneContainer");
  const messages = pane?.querySelector(".customScrollBar");
  if (!messages) return null;

  const buttons = Array.from(messages.querySelectorAll<HTMLElement>("button, [role='button']"));
  let container: HTMLElement | null = null;
  for (const button of buttons) {
    const parent = button.parentElement;
    if (!parent) continue;
    const siblings = Array.from(parent.children).filter(
      (el) => el.tagName === "BUTTON" || el.getAttribute("role") === "button",
    );
    // >=2 keeps single stray buttons (message chrome) out; the row we want has
    // Reply + Forward, sometimes Reply all too.
    if (siblings.length >= 2) container = parent;
  }
  if (!container) return null;

  const first = Array.from(container.children).find(
    (el): el is HTMLElement => el.tagName === "BUTTON" || el.getAttribute("role") === "button",
  );
  return first ? { container, nativeReply: first } : null;
}

/** The inline compose editor, once a reply (or any compose) is open. */
function findComposeEditor(doc: Document): HTMLElement | null {
  return doc.querySelector<HTMLElement>('[contenteditable="true"][role="textbox"]');
}

/**
 * Put the pending draft into the editor. Replace, never append — same
 * semantics as the Gmail compose button.
 */
function tryInsertPending(doc: Document): void {
  if (!pending) return;
  if (now() - pending.at > PENDING_TTL_MS) {
    pending = null;
    if (state.kind === "ready") setState(doc, { kind: "idle" });
    return;
  }
  const editor = findComposeEditor(doc);
  if (!editor) return;

  if (lastInserted?.isConnected) lastInserted.remove();
  const wrapper = doc.createElement("div");
  wrapper.innerHTML = pending.html;
  editor.insertBefore(wrapper, editor.firstChild);
  lastInserted = wrapper;
  pending = null;
  setState(doc, { kind: "inserted" });
  debugLog("reply button (owa): draft inserted");
}

async function onClick(doc: Document): Promise<void> {
  if (state.kind === "generating") return;
  if (state.kind === "quota") return;
  if (state.kind === "signedOut") {
    try {
      chrome.runtime.sendMessage({ type: OPEN_PANEL_MESSAGE });
    } catch {
      // The panel stays reachable from the toolbar icon.
    }
    return;
  }

  const context = detectOutlookThread(doc);
  if (!context?.accountEmail) {
    setTransient(doc, { kind: "error" });
    return;
  }

  setState(doc, { kind: "generating" });
  const response = await requestDraftFromBackground(
    context.accountEmail,
    context.providerThreadId,
  );

  const outcome = resolveDraftOutcome(response);
  if (outcome.kind === "state") {
    if (outcome.transient) setTransient(doc, outcome.state);
    else setState(doc, outcome.state);
    return;
  }
  if (outcome.kind === "disabled") {
    disableOutlookReplyButton(doc);
    return;
  }

  pending = { threadId: context.providerThreadId, html: outcome.html, at: now() };

  // Open the reply for the user: the cluster's first button is Reply. If the
  // editor is already open (or the click did not take), the watcher and the
  // "ready" state cover it.
  tryInsertPending(doc);
  if (pending) {
    const cluster = findReplyCluster(doc);
    if (cluster) cluster.nativeReply.click();
    setState(doc, { kind: "ready" });
    tryInsertPending(doc);
  }
}

function makeButton(doc: Document): HTMLElement {
  const button = doc.createElement("button");
  button.setAttribute(OWA_BUTTON_ATTRIBUTE, "");
  button.type = "button";
  // OWA's classes are build-hashed, so the pill is self-styled to match the
  // native [Reply] [Forward] pills' shape; clay accent marks it as Amarnai.
  button.style.display = "inline-flex";
  button.style.alignItems = "center";
  button.style.gap = "8px";
  button.style.padding = "5px 12px";
  button.style.border = "1px solid #BB5B33";
  button.style.borderRadius = "4px";
  button.style.background = "transparent";
  button.style.color = "#BB5B33";
  button.style.font = "inherit";
  button.style.fontWeight = "600";
  button.style.cursor = "pointer";
  button.style.margin = "4px 0px 0px 4px";
  button.style.flex = "0 0 auto";

  button.appendChild(createReplyIcon(doc, 18));

  const text = doc.createElement("span");
  text.textContent = REPLY_BUTTON_STRINGS.idle;
  button.appendChild(text);

  button.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    void onClick(doc);
  });
  return button;
}

const STYLE_ATTRIBUTE = "data-amarnai-owa-styles";

/** The icon's clay coloring; OWA has no stylesheet of ours otherwise. */
function ensureOwaStyles(doc: Document): void {
  if (doc.head.querySelector(`style[${STYLE_ATTRIBUTE}]`)) return;
  const style = doc.createElement("style");
  style.setAttribute(STYLE_ATTRIBUTE, "");
  style.textContent = REPLY_ICON_CSS;
  doc.head.appendChild(style);
}

/** Idempotent per-tick pass: inject beside the native row, follow the thread. */
export function ensureOutlookReplyButton(doc: Document = document): void {
  if (disabled) return;

  const context = detectOutlookThread(doc);
  if (!context) return;

  // A thread switch invalidates everything generated for the previous one —
  // including what the button SAYS, or it keeps promising the old thread's
  // draft ("Click Reply to insert") on the new conversation.
  if (context.providerThreadId !== currentThreadId) {
    currentThreadId = context.providerThreadId;
    pending = null;
    lastInserted = null;
    setState(doc, { kind: "idle" });
  }

  const cluster = findReplyCluster(doc);
  const existing = doc.querySelector<HTMLElement>(`[${OWA_BUTTON_ATTRIBUTE}]`);

  if (existing) {
    // Self-heal: OWA renders progressively, so an early tick can land the
    // button in a cluster that is not the final reply row. Every later tick
    // moves it to wherever that row actually is now, rather than leaving it
    // stranded where it first fit.
    if (cluster && existing.parentElement !== cluster.container) {
      cluster.container.appendChild(existing);
      debugLog("reply button (owa): re-homed to the reply row");
    }
  } else {
    if (!cluster) {
      debugLog("reply button (owa): native reply row not found");
      return;
    }
    ensureOwaStyles(doc);
    cluster.container.appendChild(makeButton(doc));
    render(doc);
    debugLog(
      "reply button (owa): injected —",
      `row buttons=${cluster.container.children.length - 1}`,
    );
  }

  tryInsertPending(doc);
}

/** The workspace switched the feature off: remove and stop. */
export function disableOutlookReplyButton(doc: Document = document): void {
  disabled = true;
  pending = null;
  for (const el of Array.from(doc.querySelectorAll(`[${OWA_BUTTON_ATTRIBUTE}]`))) el.remove();
  debugLog("reply button (owa): disabled for this workspace — removed");
}

/** Observe OWA's SPA renders, throttled like the summary scheduler. */
export function startOutlookReplyButton(doc: Document = document): () => void {
  return startDomTicker(doc, () => ensureOutlookReplyButton(doc));
}
