import { ext } from "../../platform/ext.js";
import { startScheduler, type Scheduler, type ThreadContext } from "./scheduler.js";
import { mountSummaryWidget, removeExistingWidgets, type SummaryWidget } from "./summaryWidget.js";
import {
  THREAD_SUMMARY_MESSAGE,
  type ThreadSummaryRequest,
  type ThreadSummaryResponse,
} from "./messaging.js";
import { debugLog } from "./debug.js";

/**
 * Everything a provider must supply. Both entrypoints are three lines around
 * this: all the Gmail/OWA DOM knowledge lives in the two callbacks.
 */
export interface ProviderAdapter {
  /** Read the open thread from the DOM, or null when not on a thread view. */
  detectThread: () => ThreadContext | null;
  /**
   * The element the card should be inserted before (typically the top of the
   * message list). Null when the pane has not rendered yet.
   */
  findInjectionAnchor: () => Element | null;
  /**
   * Left margin for the card so it lines up with the provider's own content
   * column (Gmail indents its message list past the avatar gutter; OWA does
   * not). Omit for flush-left.
   */
  gutterLeft?: string;
}

/**
 * Wire a provider adapter into the page: watch for thread changes, ask the
 * background for a summary, and render it above the provider's message list.
 *
 * Fails silently by construction. Anything unexpected — no anchor, signed out,
 * thread not synced, API down, snippet-kind (Gmail already shows its own
 * snippet) — renders nothing rather than putting an Amarnai error in someone's
 * mailbox.
 */
export function runContentScript(adapter: ProviderAdapter): void {
  let widget: SummaryWidget | null = null;
  let scheduler: Scheduler | null = null;
  // Guards against a slow response landing after the user moved on.
  let requestToken = 0;

  function teardownWidget(): void {
    widget?.remove();
    widget = null;
    requestToken++;
  }

  /**
   * Returns false when the page was not ready (no visible account, or the message
   * list has not rendered yet) so the scheduler retries on the next mutation tick
   * instead of latching. Returns true once a widget is mounted and the request is
   * in flight.
   */
  function requestSummary(context: ThreadContext, force = false): boolean {
    if (!context.accountEmail) {
      debugLog("no visible account email yet — cannot safely pick a mailbox");
      return false;
    }
    const token = ++requestToken;

    const anchor = adapter.findInjectionAnchor();
    if (!anchor) {
      debugLog("no injection anchor yet (message list not rendered)");
      return false;
    }

    widget?.remove();
    widget = mountSummaryWidget(anchor, { kind: "loading" }, {
      ...(adapter.gutterLeft ? { gutterLeft: adapter.gutterLeft } : {}),
    });
    if (!widget) {
      debugLog("anchor detached before mount");
      return false;
    }
    debugLog(
      `requesting summary — account=${context.accountEmail} thread=${context.providerThreadId}`,
    );

    const message: ThreadSummaryRequest = {
      type: THREAD_SUMMARY_MESSAGE,
      accountEmail: context.accountEmail,
      providerThreadId: context.providerThreadId,
      ...(force ? { force: true } : {}),
    };

    void ext.runtime
      .sendMessage(message)
      .then((response: ThreadSummaryResponse | undefined) => {
        if (token !== requestToken) return;
        if (!response?.ok) {
          debugLog(`background declined: ${response?.reason ?? "no response"}`);
          teardownWidget();
          // A settled "no" for the whole workspace, not a miss on this thread:
          // stop watching rather than spending a roundtrip per thread open.
          if (response?.reason === "injectionDisabled") stop();
          return;
        }
        const result = response.result;
        debugLog(`background returned kind=${result.kind}`);
        if (result.kind === "snippet") {
          // Gmail and OWA already show their own snippet; repeating it adds noise.
          teardownWidget();
          return;
        }
        if (result.kind === "quota") {
          widget?.update({ kind: "quota", resetsAt: result.resetsAt });
          return;
        }
        if (result.kind === "bullets") {
          widget?.update({ kind: "bullets", bullets: result.bullets });
          return;
        }
        widget?.update({ kind: "summary", text: result.text });
      })
      .catch((e) => {
        if (token !== requestToken) return;
        debugLog("sendMessage failed:", e);
        widget?.update({
          kind: "error",
          onRetry: () => {
            requestSummary(context, true);
          },
        });
      });

    // Mounted and in flight: the scheduler can stop retrying this thread.
    return true;
  }

  /** Tear down the watcher and anything on screen. Re-entered only by a reload. */
  function stop(): void {
    scheduler?.stop();
    scheduler = null;
    teardownWidget();
    removeExistingWidgets();
  }

  function start(): void {
    if (scheduler) return;
    scheduler = startScheduler({
      detect: adapter.detectThread,
      onThread: (context) => requestSummary(context),
      // (returns false while the SPA is still painting, so the scheduler retries)
      onLeave: teardownWidget,
    });
  }

  // A reload can leave a widget from the previous document behind in a bfcached
  // page; start from a clean slate.
  removeExistingWidgets();

  // Whether the card renders at all is a workspace setting (web app, on by
  // default), enforced server-side on the provider-thread summary route — the
  // extension is the half we do not control, so an old build must still stop
  // injecting. The scheduler always starts; the first thread open in a disabled
  // workspace comes back "injectionDisabled" and stops it. Re-enabling therefore
  // takes effect on the next page load, which is the right trade for not paying
  // a roundtrip per thread open forever.
  start();
}
