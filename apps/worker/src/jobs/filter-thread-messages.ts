import type { ThreadSnapshot, SnapshotMessage } from "@amarnai/ai";
import type { GmailSyncSettings } from "@amarnai/shared";

/** Gmail label IDs that are always excluded, regardless of user settings. */
const ALWAYS_EXCLUDED_LABELS = ["TRASH"] as const;

// ─── Thread label flags ───────────────────────────────────────────────────────

export type ThreadLabelFlags = {
  /** True when ALL messages in the thread carry the SPAM label. */
  gmailIsSpam: boolean;
  /** True when ALL messages in the thread carry the CATEGORY_PROMOTIONS label. */
  gmailIsPromotions: boolean;
  /** True when ALL messages in the thread carry the TRASH label. */
  gmailIsTrash: boolean;
};

const CLEAN_FLAGS: ThreadLabelFlags = {
  gmailIsSpam: false,
  gmailIsPromotions: false,
  gmailIsTrash: false,
};

/**
 * Computes per-thread label flags from a fully normalized snapshot.
 * A flag is true only when ALL messages carry that label.
 * Use this after calling normalizeGmailThread (format=full fetch).
 */
export function computeThreadLabelFlags(messages: SnapshotMessage[]): ThreadLabelFlags {
  if (messages.length === 0) return { ...CLEAN_FLAGS };
  return {
    gmailIsSpam:       messages.every((m) => (m.labelIds ?? []).includes("SPAM")),
    gmailIsPromotions: messages.every((m) => (m.labelIds ?? []).includes("CATEGORY_PROMOTIONS")),
    gmailIsTrash:      messages.every((m) => (m.labelIds ?? []).includes("TRASH")),
  };
}

/**
 * Computes per-thread label flags from the per-message label ID arrays returned
 * by listThreadsInWindow (METADATA format). Avoids a full thread fetch for threads
 * that are already in the database.
 */
export function computeThreadLabelFlagsFromMeta(messageLabelIds: string[][]): ThreadLabelFlags {
  if (messageLabelIds.length === 0) return { ...CLEAN_FLAGS };
  return {
    gmailIsSpam:       messageLabelIds.every((labels) => labels.includes("SPAM")),
    gmailIsPromotions: messageLabelIds.every((labels) => labels.includes("CATEGORY_PROMOTIONS")),
    gmailIsTrash:      messageLabelIds.every((labels) => labels.includes("TRASH")),
  };
}

/**
 * Returns true if the thread should be hidden given the current settings,
 * based on its stored label flags.
 */
export function isThreadExcluded(flags: ThreadLabelFlags, settings: GmailSyncSettings): boolean {
  if (flags.gmailIsTrash) return true;
  if (!settings.includeSpam && flags.gmailIsSpam) return true;
  if (!settings.includePromotions && flags.gmailIsPromotions) return true;
  return false;
}

/**
 * Filters a thread's messages according to GmailSyncSettings.
 *
 * - TRASH is always excluded regardless of settings.
 * - SPAM is excluded when includeSpam is false.
 * - CATEGORY_PROMOTIONS is excluded when includePromotions is false.
 *
 * Returns null if ALL messages are excluded — caller should skip the thread entirely.
 * Returns the original snapshot reference unchanged if no messages are filtered (fast path).
 * Returns a new snapshot with recomputed messageCount/latestMessageAt otherwise.
 */
export function applyThreadFilter(
  snapshot: ThreadSnapshot,
  settings: GmailSyncSettings
): ThreadSnapshot | null {
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
