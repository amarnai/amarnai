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
import { subjectIsTransactionalAuto } from "./transactional-subjects.js";

// Re-exported so existing importers (and the package index) keep their path.
export { subjectIsTransactionalAuto };

/**
 * Gmail category labels that mark non-personal, bulk-ish mail. These, and the
 * CATEGORY_PERSONAL / IMPORTANT vetoes below, are Gmail-label-specific: they read
 * from `SnapshotMessage.labelIds`, which the Gmail adapter populates.
 *
 * Outlook has no equivalent category vocabulary, so the Graph adapter emits an
 * empty `labelIds` — this weak "category" layer and its vetoes simply do not fire
 * for Outlook, and detection there rests on the provider-neutral signals (RFC
 * bulk headers, no-reply senders, transactional subjects), which port cleanly.
 * A Graph-specific mapping (e.g. inferenceClassification) is deferred until it can
 * be tuned against real Outlook mail.
 */
const BULK_CATEGORY_LABELS = [
  "CATEGORY_PROMOTIONS",
  "CATEGORY_SOCIAL",
  "CATEGORY_FORUMS",
  "CATEGORY_UPDATES",
];

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

export function senderIsNoReply(senderEmail: string): boolean {
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

/** True when a single message looks automated (headers OR no-reply sender OR bulk category OR transactional subject). */
export function isAutomatedMessage(
  msg: Pick<SnapshotMessage, "senderEmail" | "labelIds" | "automatedHeaders" | "subject">
): boolean {
  const labels = msg.labelIds ?? [];
  return (
    headersIndicateBulk(msg.automatedHeaders) ||
    senderIsNoReply(msg.senderEmail) ||
    hasBulkCategory(labels) ||
    subjectIsTransactionalAuto(msg.subject)
  );
}

/**
 * Strong (machine-origin) automation evidence: bulk headers, a no-reply sender,
 * or a transactional-auto subject (OTP / unsubscribe confirmation). Excludes the
 * weaker "Gmail bulk category" hint. A human mailbox effectively never produces
 * these, so they override Gmail's noisy IMPORTANT / Primary auto-flags; a
 * category-only signal does not. The transactional-subject case is strong on
 * purpose: such mail lands in Primary + IMPORTANT, so a weak detection would be
 * vetoed and the message would never auto-file.
 */
function isStronglyAutomatedMessage(
  msg: Pick<SnapshotMessage, "senderEmail" | "automatedHeaders" | "subject">
): boolean {
  return (
    headersIndicateBulk(msg.automatedHeaders) ||
    senderIsNoReply(msg.senderEmail) ||
    subjectIsTransactionalAuto(msg.subject)
  );
}

/**
 * Full-fetch variant: a thread is automated only when it has messages and EVERY
 * message is automated, subject to Gmail human-priority vetoes that protect
 * genuine mail — but ONLY for weak (category-only) detections:
 *
 * - CATEGORY_PERSONAL and IMPORTANT both veto a weak detection (a thread that
 *   looks automated solely because of a Gmail bulk category). Gmail's "Primary"
 *   tab is CATEGORY_PERSONAL — the default bucket for anything not
 *   Promotions/Social/Updates/Forums — and IMPORTANT is a noisy auto-heuristic;
 *   neither is a reliable "this is real correspondence" signal on its own.
 * - A STRONG machine-origin signal on every message (a no-reply sender or bulk
 *   headers) overrides both vetoes. Such mail is effectively never genuine
 *   personal correspondence, yet Gmail routinely files transactional no-reply
 *   mail (account security, banking, identity) under Primary and/or flags it
 *   IMPORTANT. Deferring to those hints would leave such mail unfiled, so a
 *   strong signal wins. This is what guarantees every no-reply thread is
 *   detected (and thus auto-filed to the catch-all folder).
 *
 * `selfEmail` is the mailbox owner's address. Their own sent messages are excluded
 * before the every-message check: replying to a `no-reply@` notification must not
 * make the thread look human (the user's reply is never automated, so a single
 * reply would otherwise defeat detection on an otherwise-automated thread).
 *
 * A thread consisting ONLY of the owner's own messages is normally human (sent
 * mail) and not automated — except when every such message is itself STRONGLY
 * automated, e.g. Gmail's one-click "unsubscribe" message, which Gmail sends from
 * the user's own address with the subject literally "unsubscribe". Requiring a
 * strong signal on every message keeps genuine sent mail from being auto-filed.
 *
 * Note: matching is on the `From` address only, so spoofed inbound mail forging
 * the owner's address would also be excluded. The blast radius is limited to
 * auto-filing into the visible catch-all folder (nothing is sent or deleted), so
 * direction verification (e.g. the SENT label) is intentionally not done here.
 */
export function detectAutomatedThread(messages: SnapshotMessage[], selfEmail?: string): boolean {
  const self = selfEmail?.trim().toLowerCase();
  const external = self
    ? messages.filter((m) => m.senderEmail.trim().toLowerCase() !== self)
    : messages;

  if (external.length === 0) {
    // Entirely the owner's own messages: human sent mail, UNLESS every message is
    // strongly automated (Gmail-generated mail sent on the user's behalf). See the
    // doc comment above.
    return messages.length > 0 && messages.every(isStronglyAutomatedMessage);
  }
  if (!external.every(isAutomatedMessage)) return false;

  // Gmail's human-priority hints (Primary/CATEGORY_PERSONAL, IMPORTANT) only veto
  // a weak (category-only) detection. A strong machine-origin signal on every
  // message overrides them — see the doc comment above.
  const allStrong = external.every(isStronglyAutomatedMessage);
  if (!allStrong) {
    const hasLabel = (label: string) => external.some((m) => (m.labelIds ?? []).includes(label));
    if (hasLabel("CATEGORY_PERSONAL")) return false;
    if (hasLabel("IMPORTANT")) return false;
  }
  return true;
}
