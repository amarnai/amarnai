import { DEFAULT_GMAIL_SYNC_SETTINGS } from "@amarnai/shared";

// Which threads a workspace is allowed to see at all, before any queue, folder
// or search filter narrows it further.
//
// Shared rather than duplicated because a thread hidden from the web app's list
// must be hidden from every other surface too: the injected panel's queue would
// otherwise surface a spam thread the inbox itself refuses to show, and no user
// would be able to work out why.

/** The subset of GmailSyncSettings that decides visibility. */
export type ThreadVisibilitySettings = {
  includeSpam: boolean;
  includePromotions: boolean;
  blacklistedSenderEmails: string[];
};

export const DEFAULT_THREAD_VISIBILITY: ThreadVisibilitySettings = {
  includeSpam: DEFAULT_GMAIL_SYNC_SETTINGS.includeSpam,
  includePromotions: DEFAULT_GMAIL_SYNC_SETTINGS.includePromotions,
  blacklistedSenderEmails: [],
};

/**
 * Trash is always excluded; spam and promotions only when the workspace has not
 * opted into them; blacklisted senders are dropped by a NOT EXISTS over the
 * thread's messages.
 *
 * The result is spread into every `where` a listing route builds, including the
 * count queries, so the pill totals and the page agree about what exists.
 */
export function buildThreadVisibilityWhere(
  workspaceId: string,
  settings: ThreadVisibilitySettings,
) {
  const blacklist = settings.blacklistedSenderEmails ?? [];
  return {
    workspaceId,
    gmailIsTrash: false,
    ...(settings.includeSpam ? {} : { gmailIsSpam: false }),
    ...(settings.includePromotions ? {} : { gmailIsPromotions: false }),
    ...(blacklist.length > 0
      ? { NOT: { messages: { some: { senderEmail: { in: blacklist } } } } }
      : {}),
  };
}
