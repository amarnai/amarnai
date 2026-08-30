import type { ThreadSnapshot, SnapshotMessage } from "@aziru/ai";
import { detectAutomatedThread, isDraftMessage } from "@aziru/ai";
import type { GmailSyncSettings } from "@aziru/shared";

/** Gmail label IDs that are always excluded, regardless of user settings. */
const ALWAYS_EXCLUDED_LABELS = ["TRASH"] as const;

/**
 * True when a message is excluded no matter what the workspace settings say:
 * it is in the trash, or it is an unsent draft.
 *
 * Distinct from the settings-driven exclusions (spam, promotions) in one way that
 * matters: a settings exclusion is reversible, so those messages are kept in the
 * database and can reappear when the setting flips. These cannot come back, so
 * they must be absent from storage entirely, or a message the user deleted (and a
 * reply they never sent) keeps feeding classification, summaries, and drafts.
 */
export function isAlwaysExcludedMessage(msg: SnapshotMessage): boolean {
  if (isDraftMessage(msg)) return true;
  const labels = msg.labelIds ?? [];
  return ALWAYS_EXCLUDED_LABELS.some((label) => labels.includes(label));
}

// ─── Thread label flags ───────────────────────────────────────────────────────

/**
 * Label-derivable thread flags. Every field here is computed purely from Gmail
 * label IDs, so both the full-fetch and metadata-only paths can produce them.
 */
export type MetaThreadLabelFlags = {
  /** True when ALL messages in the thread carry the SPAM label. */
  gmailIsSpam: boolean;
  /** True when ALL messages in the thread carry the CATEGORY_PROMOTIONS label. */
  gmailIsPromotions: boolean;
  /** True when ALL messages in the thread carry the TRASH label. */
  gmailIsTrash: boolean;
};

/**
 * Full-fetch flags: the label-derivable flags plus `isAutomated`, which needs
 * sender + header data and therefore can ONLY come from the full-fetch path.
 * `isAutomated` is deliberately absent from {@link MetaThreadLabelFlags} so a
 * categories-only computation can never be the source of an `isAutomated` write.
 */
export type ThreadLabelFlags = MetaThreadLabelFlags & {
  /** True when every message looks automated/bulk (notifications, newsletters, service mail). */
  isAutomated: boolean;
};

const CLEAN_META_FLAGS: MetaThreadLabelFlags = {
  gmailIsSpam: false,
  gmailIsPromotions: false,
  gmailIsTrash: false,
};

/**
 * Computes per-thread label flags from a fully normalized snapshot.
 * A flag is true only when ALL messages carry that label.
 * Use this after calling normalizeGmailThread (format=full fetch).
 *
 * `selfEmail` is the mailbox owner's address, forwarded to the detector so the
 * user's own replies do not defeat automated-mail detection.
 */
export function computeThreadLabelFlags(
  messages: SnapshotMessage[],
  selfEmail?: string
): ThreadLabelFlags {
  if (messages.length === 0) return { ...CLEAN_META_FLAGS, isAutomated: false };
  return {
    gmailIsSpam:       messages.every((m) => (m.labelIds ?? []).includes("SPAM")),
    gmailIsPromotions: messages.every((m) => (m.labelIds ?? []).includes("CATEGORY_PROMOTIONS")),
    gmailIsTrash:      messages.every((m) => (m.labelIds ?? []).includes("TRASH")),
    isAutomated:       detectAutomatedThread(messages, selfEmail),
  };
}

/**
 * Computes per-thread label flags from the per-message label ID arrays returned
 * by listThreadsPage (METADATA format). Avoids a full thread fetch for threads
 * that are already in the database.
 *
 * Returns ONLY label-derivable flags. It cannot see senders or headers, so it
 * never produces `isAutomated`: doing so would downgrade a correct full-fetch
 * verdict (e.g. a no-reply thread) to false. The detector's labels-only variant
 * is still used by callers that want a category-based hint, but it must not feed
 * an `isAutomated` write on the metadata refresh path.
 */
export function computeThreadLabelFlagsFromMeta(messageLabelIds: string[][]): MetaThreadLabelFlags {
  if (messageLabelIds.length === 0) return { ...CLEAN_META_FLAGS };
  return {
    gmailIsSpam:       messageLabelIds.every((labels) => labels.includes("SPAM")),
    gmailIsPromotions: messageLabelIds.every((labels) => labels.includes("CATEGORY_PROMOTIONS")),
    gmailIsTrash:      messageLabelIds.every((labels) => labels.includes("TRASH")),
  };
}

// ─── Sent-only thread detection ─────────────────────────────────────────────

/**
 * True when a single message's Gmail labels mark it as OUTBOUND: it carries the
 * SENT label and does NOT carry INBOX. The INBOX exception keeps self-addressed
 * "note to self" mail (SENT + INBOX) importable, matching Outlook, where such
 * mail lands in the inbox.
 *
 * Undefined or empty labels are never outbound: unknown label data must fail
 * open (fetch/import normally), never fail closed. This also keeps Outlook
 * immune — its normalizer emits `labelIds: []`, so nothing ever qualifies. That
 * is deliberate even though Outlook snapshots now carry the owner's Sent Items
 * replies: folder membership is not a Gmail label, and the identity-based rules
 * below are what cover Outlook.
 *
 * NOTE: `packages/gmail` cannot import this worker module (and @aziru/mail →
 * @aziru/gmail would be circular), so gmail-client.ts keeps a private copy of
 * this exact rule in its history classification. Keep the two in sync.
 */
export function isOutboundLabelSet(labels: readonly string[] | undefined): boolean {
  return !!labels && labels.includes("SENT") && !labels.includes("INBOX");
}

/**
 * True when a thread consists ONLY of the user's own outbound mail (a sent email
 * awaiting a reply), computed from the per-message label arrays returned by
 * listThreadsPage (METADATA format). Such threads are never imported.
 *
 * False for zero messages: a fetch-failed metadata placeholder is
 * `messageLabelIds: []`, and the empty case must not be mistaken for sent-only.
 */
export function isSentOnlyThreadMeta(messageLabelIds: readonly (readonly string[])[]): boolean {
  return messageLabelIds.length > 0 && messageLabelIds.every(isOutboundLabelSet);
}

/**
 * Identity-based sent-only detection from the metadata path (backfill's
 * listThreadsPage), using per-message sender + recipient addresses instead of
 * Gmail labels: sent-only when the owner is the sole sender AND is not a
 * recipient of any message (the latter keeps notes-to-self importable). This is
 * the label-independent counterpart to {@link isSentOnlyThreadMeta}; the backfill
 * caller ORs the two so a thread is skipped pre-fetch whether its labels are
 * clean (label rule) or an alias/INBOX case the labels misreport (identity rule).
 *
 * `messageRecipients` is aligned by index with `messageSenders`. False for zero
 * messages (a fetch-failed metadata placeholder carries empty arrays).
 */
export function isSentOnlyThreadMetaByIdentity(
  messageSenders: readonly string[],
  messageRecipients: readonly (readonly string[])[],
  ownerEmail: string
): boolean {
  if (messageSenders.length === 0) return false;
  const owner = ownerEmail.toLowerCase();
  if (!messageSenders.every((s) => s.toLowerCase() === owner)) return false;
  const ownerIsRecipient = messageRecipients.some((rs) =>
    rs.some((r) => r.toLowerCase() === owner)
  );
  return !ownerIsRecipient;
}

/**
 * Correctness backstop, run after a full thread fetch. Combines two safe signals:
 *
 *  - IDENTITY (primary): the mailbox owner is the sole sender AND is not a
 *    recipient of any message — exactly "an email I wrote that has no reply".
 *    This does NOT depend on Gmail's SENT/INBOX labels, which are unreliable
 *    here (a plain external send can still carry INBOX, defeating a label check).
 *  - LABEL (secondary): every message is a Gmail SENT-without-INBOX message.
 *    Catches "send mail as" aliases, whose From is not the connected address so
 *    identity alone would miss them.
 *
 * A thread is sent-only if EITHER holds. Both are one-directional (they only ever
 * add skips for genuine owner-outbound mail); an inbound message carries INBOX
 * and a non-owner sender, so it fails both. Notes-to-self (owner is a recipient,
 * SENT+INBOX) fail both and stay visible. False for zero messages.
 */
export function isSentOnlyThreadSnapshot(
  messages: readonly SnapshotMessage[],
  ownerEmail: string
): boolean {
  if (messages.length === 0) return false;
  const owner = ownerEmail.toLowerCase();
  const everyMessageFromOwner = messages.every(
    (m) => m.senderEmail.toLowerCase() === owner
  );
  const ownerIsRecipient = messages.some((m) =>
    [...m.toEmails, ...m.ccEmails].some((e) => e.toLowerCase() === owner)
  );
  if (everyMessageFromOwner && !ownerIsRecipient) return true;
  // Alias/label fallback: every message is a Gmail outbound (SENT, not INBOX).
  return messages.every((m) => isOutboundLabelSet(m.labelIds));
}

/**
 * Returns true if the thread should be hidden given the current settings,
 * based on its stored label flags and sender blacklist.
 */
export function isThreadExcluded(
  flags: MetaThreadLabelFlags,
  settings: GmailSyncSettings,
  senderEmails?: string[]
): boolean {
  if (flags.gmailIsTrash) return true;
  if (!settings.includeSpam && flags.gmailIsSpam) return true;
  if (!settings.includePromotions && flags.gmailIsPromotions) return true;
  if (
    senderEmails &&
    senderEmails.length > 0 &&
    settings.blacklistedSenderEmails.length > 0 &&
    senderEmails.some((e) => settings.blacklistedSenderEmails.includes(e.toLowerCase()))
  ) return true;
  return false;
}

/**
 * Filters a thread's messages according to GmailSyncSettings.
 *
 * - TRASH and DRAFT are always excluded regardless of settings.
 * - SPAM is excluded when includeSpam is false.
 * - CATEGORY_PROMOTIONS is excluded when includePromotions is false.
 * - Threads where any message sender is blacklisted are excluded entirely.
 *
 * Returns null if the thread is blacklisted or ALL messages are excluded.
 * Returns the original snapshot reference unchanged if no messages are filtered (fast path).
 * Returns a new snapshot with recomputed messageCount/latestMessageAt otherwise.
 */
export function applyThreadFilter(
  snapshot: ThreadSnapshot,
  settings: GmailSyncSettings
): ThreadSnapshot | null {
  // Exclude the entire thread if any sender is blacklisted.
  if (settings.blacklistedSenderEmails.length > 0) {
    const blacklisted = snapshot.messages.some((m) =>
      settings.blacklistedSenderEmails.includes(m.senderEmail.toLowerCase())
    );
    if (blacklisted) return null;
  }

  const eligible = snapshot.messages.filter((m) => isEligibleMessage(m, settings));

  if (eligible.length === 0) return null;
  if (eligible.length === snapshot.messages.length) return snapshot;

  const latestMessageAt = eligible.reduce<Date>(
    (acc, m) => (m.receivedAt > acc ? m.receivedAt : acc),
    new Date(0)
  );

  return {
    ...snapshot,
    messages: eligible,
    messageCount: eligible.length,
    latestMessageAt,
  };
}

function isEligibleMessage(msg: SnapshotMessage, settings: GmailSyncSettings): boolean {
  const labels = msg.labelIds ?? [];

  if (isAlwaysExcludedMessage(msg)) return false;

  if (!settings.includeSpam && labels.includes("SPAM")) return false;
  if (!settings.includePromotions && labels.includes("CATEGORY_PROMOTIONS")) return false;

  return true;
}
