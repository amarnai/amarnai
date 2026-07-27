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
  eyebrow: "Amarnai",
  loading: "Summarizing…",
  error: "Could not summarize this thread.",
  retry: "Retry",
  quota: (resetsAt: string) => `No summaries remaining this month · resets ${resetsAt}`,
} as const;

/** Short, UTC-stable reset date ("Aug 1"), matching the in-app quota copy. */
export function formatResetDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" });
}
