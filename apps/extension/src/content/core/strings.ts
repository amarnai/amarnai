// English-only UI strings for the injected widget.
//
// NOT Lingui-wrapped, deliberately. The content scripts are standalone IIFE
// bundles injected into a third-party page; pulling in @lingui/core plus all
// sixteen compiled catalogs to translate four short labels would multiply the
// injected bundle for no proportionate gain. The summary text itself — the only
// substantial content in the widget — is already generated in the workspace
// locale by the server, so a non-English user still reads their own language.
//
// FOLLOW-UP: if the widget grows beyond these labels, move it to Lingui and load
// only the active locale's catalog at runtime.
export const STRINGS = {
  eyebrow: "Summary",
  loading: "Summarizing…",
  error: "Could not summarize this thread.",
  retry: "Retry",
  quota: (resetsAt: string) => `No summaries remaining this month · resets ${resetsAt}`,
} as const;

/**
 * Labels for the "Amarnai Reply" button in the provider's own compose. Short by
 * necessity: they sit in a crowded native toolbar next to Send, so the detail
 * goes in the tooltip and the label stays scannable.
 */
export const REPLY_BUTTON_STRINGS = {
  idle: "Amarnai Reply",
  /** Hover tooltip on the injected entry points (bottom-bar pill, header icon). */
  entryTooltip: "Reply with Amarnai",
  generating: "Drafting…",
  notSorted: "Still sorting…",
  error: "Couldn't draft",
  signedOut: "Sign in to Amarnai",
  quota: "No drafts left",
  tooltips: {
    idle: "Draft a reply to this thread with Amarnai",
    generating: "Amarnai is writing a reply…",
    notSorted: "Amarnai has not sorted this thread yet — try again in a moment",
    error: "Something went wrong. Click to try again.",
    signedOut: "Open the Amarnai panel to sign in",
    quota: (resetsAt: string) => `No drafts remaining this month · resets ${resetsAt}`,
  },
} as const;

/** Short, UTC-stable reset date ("Aug 1"), matching the in-app quota copy. */
export function formatResetDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" });
}
