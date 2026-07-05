import type { ThreadSnapshot, SnapshotMessage } from "@amarnai/ai";
import { detectAutomatedThread } from "@amarnai/ai";
import type { GmailSyncSettings } from "@amarnai/shared";

/** Gmail label IDs that are always excluded, regardless of user settings. */
const ALWAYS_EXCLUDED_LABELS = ["TRASH"] as const;

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
 * - TRASH is always excluded regardless of settings.
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

  for (const label of ALWAYS_EXCLUDED_LABELS) {
    if (labels.includes(label)) return false;
  }

  if (!settings.includeSpam && labels.includes("SPAM")) return false;
  if (!settings.includePromotions && labels.includes("CATEGORY_PROMOTIONS")) return false;

  return true;
}
