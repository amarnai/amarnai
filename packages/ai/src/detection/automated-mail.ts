/**
 * Cheap, header/label-based detection of automated/bulk email (notifications,
 * newsletters, service updates) so it can be auto-filed without an LLM call.
 *
 * Design goals:
 * - Detect bulk mail from BOTH Google (no-reply senders, Gmail categories) and
 *   any other source (RFC bulk headers), with no LLM or embedding cost.
 * - Minimise FALSE POSITIVES: a thread is automated only when EVERY message is
 *   automated, and any human-priority signal (IMPORTANT / CATEGORY_PERSONAL)
 *   vetoes the whole thread. We would rather under-detect (thread still routes
 *   normally) than mis-file a genuine personal email.
 *
 * This module is pure and side-effect free.
 */
import type { SnapshotMessage } from "../thread-snapshot.js";

/** Gmail category labels that mark non-personal, bulk-ish mail. */
const BULK_CATEGORY_LABELS = [
  "CATEGORY_PROMOTIONS",
  "CATEGORY_SOCIAL",
  "CATEGORY_FORUMS",
  "CATEGORY_UPDATES",
];

/** Labels that veto automation — a strong "this matters to the human" signal. */
const HUMAN_VETO_LABELS = ["IMPORTANT", "CATEGORY_PERSONAL"];

/** `Precedence` header values that indicate bulk/automated mail. */
const BULK_PRECEDENCE = ["bulk", "list", "junk", "auto_reply"];

/**
 * No-reply style local parts. Matches the local part of the sender address, so
 * it catches `google-maps-noreply@google.com`, `no-reply@…`, `notifications@…`,
 * `mailer-daemon@…` across any domain. Anchored on word boundaries so it does
 * not fire on, say, `reply@person.com`.
 */
const NO_REPLY_LOCALPART =
  /(^|[._-])(no-?reply|do-?not-?reply|donotreply|notifications?|mailer-daemon|bounce|automated)([._-]|$)/i;

function hasBulkCategory(labelIds: readonly string[]): boolean {
  return labelIds.some((l) => BULK_CATEGORY_LABELS.includes(l));
}

function hasHumanVeto(labelIds: readonly string[]): boolean {
  return labelIds.some((l) => HUMAN_VETO_LABELS.includes(l));
}

function senderIsNoReply(senderEmail: string): boolean {
  const localPart = senderEmail.split("@")[0] ?? "";
  return NO_REPLY_LOCALPART.test(localPart);
}

function headersIndicateBulk(h: SnapshotMessage["automatedHeaders"]): boolean {
  if (!h) return false;
  if (h.listUnsubscribe || h.listId) return true;
  // RFC 3834: any Auto-Submitted other than "no" means machine-generated.
  if (h.autoSubmitted && h.autoSubmitted.trim().toLowerCase() !== "no") return true;
  if (h.precedence && BULK_PRECEDENCE.includes(h.precedence.trim().toLowerCase())) return true;
  return false;
}

/** True when a single message looks automated (headers OR no-reply sender OR bulk category). */
export function isAutomatedMessage(
  msg: Pick<SnapshotMessage, "senderEmail" | "labelIds" | "automatedHeaders">
): boolean {
  const labels = msg.labelIds ?? [];
  return (
    headersIndicateBulk(msg.automatedHeaders) ||
    senderIsNoReply(msg.senderEmail) ||
    hasBulkCategory(labels)
  );
}

/**
 * Strong (machine-origin) automation evidence: bulk headers or a no-reply
 * sender. Excludes the weaker "Gmail bulk category" hint. A human mailbox
 * effectively never produces these, so they override Gmail's noisy IMPORTANT
 * auto-flag; a category-only signal does not.
 */
function isStronglyAutomatedMessage(
  msg: Pick<SnapshotMessage, "senderEmail" | "automatedHeaders">
): boolean {
  return headersIndicateBulk(msg.automatedHeaders) || senderIsNoReply(msg.senderEmail);
}

/**
 * Full-fetch variant: a thread is automated only when it has messages and EVERY
 * message is automated, subject to two vetoes that protect genuine mail:
 *
 * - CATEGORY_PERSONAL is a hard veto (Gmail explicitly classified it personal).
 * - IMPORTANT vetoes ONLY weak (category-only) detections. Gmail's IMPORTANT is
 *   a noisy auto-heuristic that routinely flags bulk (Google's own notifications
 *   especially), so a strong machine-origin signal on every message overrides it.
 */
export function detectAutomatedThread(messages: SnapshotMessage[]): boolean {
  if (messages.length === 0) return false;
  if (messages.some((m) => (m.labelIds ?? []).includes("CATEGORY_PERSONAL"))) return false;
  if (!messages.every(isAutomatedMessage)) return false;

  const allStrong = messages.every(isStronglyAutomatedMessage);
  if (!allStrong && messages.some((m) => (m.labelIds ?? []).includes("IMPORTANT"))) return false;
  return true;
}

/**
 * Labels-only variant for metadata-only paths (no headers, no sender parsing
 * available). Necessarily narrower: detects only via Gmail bulk categories,
 * with the same veto and `every` guards. Safe — it only ever under-detects.
 */
export function detectAutomatedThreadFromMeta(messageLabelIds: string[][]): boolean {
  if (messageLabelIds.length === 0) return false;
  if (messageLabelIds.some((labels) => hasHumanVeto(labels))) return false;
  return messageLabelIds.every((labels) => hasBulkCategory(labels));
}
