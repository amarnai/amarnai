// The SPA-navigation loop shared by both providers.
//
// Gmail and OWA are single-page apps: opening a thread mutates the DOM instead
// of loading a document, so there is no navigation event to hook. The only
// reliable signal is "the DOM changed, look again", which is why this is a
// throttled MutationObserver on <body> plus the URL-change events, rather than
// anything cleverer.
//
// Everything provider-specific is behind the `detect` and `render` callbacks;
// this file knows only that a thread has an id and that the id can change.

import { debugLog } from "./debug.js";

export const OBSERVE_THROTTLE_MS = 300;

export interface ThreadContext {
  providerThreadId: string;
  accountEmail: string | null;
}

/**
 * How many times a single thread may be re-attempted before we stop trying.
 * Attempts are only made on DOM-mutation ticks (throttled to OBSERVE_THROTTLE_MS),
 * so this is roughly twenty seconds of mail-app activity — long enough for the SPA
 * to finish painting the conversation, short enough that a page we will never
 * understand does not get re-probed for the lifetime of the tab.
 *
 * Sized for the SLOWEST ready-signal we wait on, which is a cold OWA load
 * (refresh / deep link): the thread id is detectable from the message list long
 * before the reading pane exists, so attempts start burning early and the budget
 * has to span the whole conversation render. The providers deliberately refuse to
 * anchor on a half-rendered pane (see findOutlookInjectionAnchor), so running out
 * here means no card at all — the cap must not be the binding constraint.
 */
export const MAX_ATTEMPTS_PER_THREAD = 60;

export interface SchedulerOptions {
  /** Read the currently-open thread out of the DOM, or null on a list view. */
  detect: () => ThreadContext | null;
  /**
   * Handle a newly-opened thread. Return false when the page was not ready yet
   * (the account element or the injection anchor had not rendered), and the
   * scheduler will retry on the next mutation tick rather than giving up.
   *
   * This matters because content scripts run at document_idle, which in Gmail is
   * routinely BEFORE the conversation view exists. Latching on the first sighting
   * would permanently suppress the widget for that thread.
   */
  onThread: (context: ThreadContext) => boolean;
  /** Called when the user leaves a thread (list view, or a different thread). */
  onLeave: () => void;
}

export interface Scheduler {
  /** Force a re-check (e.g. after the kill-switch flips back on). */
  check(): void;
  stop(): void;
}

export function startScheduler(options: SchedulerOptions): Scheduler {
  let currentThreadId: string | null = null;
  let throttleTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  // Attempts made for currentThreadId, and whether one of them succeeded.
  let attempts = 0;
  let handled = false;

  function check(): void {
    if (stopped) return;
    let context: ThreadContext | null = null;
    try {
      context = options.detect();
    } catch {
      // A DOM shape we do not recognize is not an error worth surfacing: the
      // mail page keeps working, we simply show nothing.
      context = null;
    }

    if (!context) {
      if (currentThreadId !== null) {
        currentThreadId = null;
        attempts = 0;
        safely(options.onLeave);
      }
      return;
    }

    const sameThread = context.providerThreadId === currentThreadId;
    // Settled: handled successfully, or retried to exhaustion. Nothing to do.
    if (sameThread && (handled || attempts >= MAX_ATTEMPTS_PER_THREAD)) return;

    if (!sameThread) {
      // Switching straight from one thread to another still tears down first, so a
      // stale summary can never linger over the wrong thread.
      if (currentThreadId !== null) safely(options.onLeave);
      currentThreadId = context.providerThreadId;
      attempts = 0;
      handled = false;
    }

    attempts++;
    handled = safely(() => options.onThread(context)) === true;
    if (!handled) {
      debugLog(
        `thread ${context.providerThreadId}: not ready (attempt ${attempts}/${MAX_ATTEMPTS_PER_THREAD})`,
      );
    }
  }

  function scheduleCheck(): void {
    if (stopped || throttleTimer !== null) return;
    throttleTimer = setTimeout(() => {
      throttleTimer = null;
      check();
    }, OBSERVE_THROTTLE_MS);
  }

  const observer = new MutationObserver(scheduleCheck);
  observer.observe(document.body, { childList: true, subtree: true });

  // Gmail navigates by hash; OWA pushes history entries. Listen for both so a
  // navigation that does not happen to mutate <body> is still noticed.
  window.addEventListener("hashchange", scheduleCheck);
  window.addEventListener("popstate", scheduleCheck);

  function stop(): void {
    if (stopped) return;
    stopped = true;
    if (throttleTimer !== null) clearTimeout(throttleTimer);
    throttleTimer = null;
    observer.disconnect();
    window.removeEventListener("hashchange", scheduleCheck);
    window.removeEventListener("popstate", scheduleCheck);
    window.removeEventListener("pagehide", stop);
  }

  // Never outlive the page: a live observer on a bfcached document keeps firing.
  window.addEventListener("pagehide", stop);

  check();

  return { check, stop };
}

/**
 * The same observer loop without the thread bookkeeping: run `tick` on every
 * settled burst of DOM change and on every SPA navigation, plus once up front.
 * Returns a teardown.
 *
 * Used by the injectors that are idempotent by marker attribute (the reply
 * entry points, the OWA reply button) and so need no "have I handled this
 * thread yet" state — they just want to be re-run whenever the page moves.
 */
export function startDomTicker(doc: Document, tick: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    if (timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      tick();
    }, OBSERVE_THROTTLE_MS);
  };

  const observer = new MutationObserver(schedule);
  observer.observe(doc.body, { childList: true, subtree: true });
  doc.defaultView?.addEventListener("hashchange", schedule);
  doc.defaultView?.addEventListener("popstate", schedule);

  tick();

  return () => {
    observer.disconnect();
    doc.defaultView?.removeEventListener("hashchange", schedule);
    doc.defaultView?.removeEventListener("popstate", schedule);
    clearTimeout(timer);
  };
}

/**
 * Run a callback, swallowing anything it throws, and return its value (undefined
 * if it threw). Never break the host page.
 */
function safely<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch (e) {
    debugLog("content script callback failed:", e);
    return undefined;
  }
}
