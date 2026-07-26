/**
 * Whether the label/category writeback feature is enabled in this deployment.
 * Mirrors config.mail.labelWritebackEnabled without pulling @amarnai/config into
 * the web build (same pattern as isOutlookConfigured). Server-only.
 *
 * When on, the write scope (gmail.modify / Mail.ReadWrite) is requested UPFRONT
 * at Google sign-in and at inbox connect — a product decision: writeback is on
 * by default, and upcoming in-Gmail/Outlook features (thread summaries, draft
 * replies surfaced inside the provider UI) need the same grant, so consent is
 * gathered once instead of via per-feature incremental prompts. Keep this flag
 * OFF in production until Google's verification of gmail.modify is approved,
 * or every new sign-in/connect will hit the unverified-scope warning.
 */
export function isLabelWritebackEnabled(): boolean {
  return process.env["LABEL_WRITEBACK_ENABLED"] === "true";
}
