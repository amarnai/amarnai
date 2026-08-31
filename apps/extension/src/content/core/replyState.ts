// The "Aziru Reply" button's state machine, shared by both providers.
//
// Gmail's button lives in InboxSDK's compose tray and OWA's is a hand-rolled
// pill in the reading pane, so how a state is PAINTED differs completely. What
// does not differ is which states exist, what each one says, and which response
// from the background leads to which state — that part was copied verbatim
// between the two injectors, and lives here instead.
//
// Each injector keeps its own emitter (Kefir stream vs. direct DOM write) and
// its own insertion, which is where the real provider differences are.

import { draftBodyToHtml } from "@aziru/core/drafts";
import { REPLY_BUTTON_STRINGS, formatResetDate } from "./strings.js";
import type { GenerateDraftResponse } from "./messaging.js";

/**
 * `ready` is reachable only in OWA: there the draft is generated before the
 * compose editor exists, so it may have to wait for one. Gmail's button is
 * already inside the compose, so it inserts straight away.
 */
export type ReplyButtonState =
  | { kind: "idle" }
  | { kind: "generating" }
  | { kind: "ready" }
  | { kind: "inserted" }
  | { kind: "error" }
  | { kind: "signedOut" }
  | { kind: "quota"; resetsAt: string };

/**
 * How long a transient outcome (an error) stays on the button before it returns
 * to idle. Long enough to read, short enough that the button is ready again by
 * the time the user has fixed the cause.
 */
export const TRANSIENT_MS = 6_000;

/** What the button says in a given state. */
export function describeReplyState(state: ReplyButtonState): {
  label: string;
  tooltip: string;
  enabled: boolean;
} {
  const S = REPLY_BUTTON_STRINGS;
  switch (state.kind) {
    case "generating":
      return { label: S.generating, tooltip: S.tooltips.generating, enabled: false };
    case "ready":
      return { label: S.readyToInsert, tooltip: S.tooltips.readyToInsert, enabled: true };
    case "inserted":
      // The label stays "Aziru Reply": a toolbar button is an identity, not a
      // status readout, and renaming it after a click reads as a different
      // control. The outcome lives in the tooltip.
      return { label: S.idle, tooltip: S.tooltips.inserted, enabled: true };
    case "error":
      return { label: S.error, tooltip: S.tooltips.error, enabled: true };
    case "signedOut":
      return { label: S.signedOut, tooltip: S.tooltips.signedOut, enabled: true };
    case "quota":
      return {
        label: S.quota,
        tooltip: S.tooltips.quota(formatResetDate(state.resetsAt)),
        // Nothing a click can do until the window resets.
        enabled: false,
      };
    case "idle":
      return { label: S.idle, tooltip: S.tooltips.idle, enabled: true };
  }
}

/**
 * What a generation attempt came to.
 *
 * `disabled` and `insert` are the two the injectors handle themselves: removing
 * the button and taking down the other surfaces is provider-specific, and so is
 * where the HTML goes. Everything else is just a state to show.
 */
export type DraftOutcome =
  | { kind: "insert"; html: string }
  | { kind: "disabled" }
  | { kind: "state"; state: ReplyButtonState; transient: boolean };

/**
 * Map the background's answer to an outcome. Pure, so the whole classification —
 * including which states time out back to idle — is testable on its own and
 * cannot drift between the two buttons.
 */
export function resolveDraftOutcome(response: GenerateDraftResponse): DraftOutcome {
  if (!response.ok) {
    switch (response.reason) {
      case "signedOut":
      case "noWorkspace":
        // Both mean "this mailbox is not usable from here"; the panel is where
        // signing in or connecting happens. Settled, so it does not time out.
        return { kind: "state", state: { kind: "signedOut" }, transient: false };
      case "injectionDisabled":
        // A settled answer, not a transient miss: the button should go away
        // rather than invite a retry that cannot succeed.
        return { kind: "disabled" };
      default:
        return { kind: "state", state: { kind: "error" }, transient: true };
    }
  }

  const result = response.result;
  if (result.kind === "quota") {
    return { kind: "state", state: { kind: "quota", resetsAt: result.resetsAt }, transient: false };
  }
  const html = draftBodyToHtml(result.body);
  if (html === "") return { kind: "state", state: { kind: "error" }, transient: true };
  return { kind: "insert", html };
}
