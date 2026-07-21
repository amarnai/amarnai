import type { ThreadSnapshot } from "@amarnai/ai";

/**
 * Provider-neutral mail contract. This is the seam every mailbox provider sits
 * behind: Gmail today ({@link https} GmailClient), Outlook via Microsoft Graph
 * next. Callers depend only on this interface and the normalized
 * {@link ThreadSnapshot} output, never on a provider's raw JSON.
 *
 * The method set is the intersection of what the sync/backfill/classify pipeline
 * actually needs, named neutrally (no `history`/`gmail` in the surface). A second
 * provider is a second implementation of this interface plus its own normalizer.
 */
export interface MailProvider {
  /** Exchange the stored refresh token for a short-lived access token. */
  refreshAccessToken(): Promise<string>;

  /** The connected mailbox's identity and current sync cursor. */
  getProfile(): Promise<MailProfile>;

  /**
   * Delta sync: thread IDs changed since `cursor`, plus the new cursor to
   * persist. Throws {@link MailCursorExpiredError} when the cursor is no longer
   * valid and the caller must fall back to a full resync.
   */
  listChangesSince(cursor: string): Promise<MailChangeResult>;

  /**
   * One page of threads with activity after `afterMs` (Unix ms; 0 = full
   * history), resuming from `pageToken`. Used by the resumable backfill.
   */
  listThreadsPage(opts: {
    afterMs: number;
    pageToken?: string | undefined;
    pageSize?: number | undefined;
  }): Promise<MailThreadPage>;

  /** Thread IDs matching a provider search query (targeted backfill passes). */
  listThreadIdsByQuery(q: string, maxResults: number): Promise<string[]>;

  /** Most recent thread IDs — the cold-resync fallback when the cursor is gone. */
  listRecentThreadIds(maxResults?: number): Promise<string[]>;

  /**
   * Fetch a thread and normalize it to a {@link ThreadSnapshot}. Folds the raw
   * fetch and the per-provider normalizer so callers never touch provider JSON.
   * Throws {@link MailThreadNotFoundError} when the provider definitively
   * reports the thread as gone — the only error callers may skip on; every
   * other failure is transient and must propagate.
   */
  getThreadSnapshot(threadId: string): Promise<ThreadSnapshot>;

  /** Register a push watch/subscription for this mailbox. */
  registerWatch(target: string): Promise<MailWatchResult>;

  /** Tear down the push watch/subscription (best-effort, before token revoke). */
  stopWatch(): Promise<void>;
}

/** Connected mailbox identity plus the cursor to seed delta sync from. */
export type MailProfile = {
  emailAddress: string;
  /** Opaque provider sync cursor (Gmail historyId; Graph deltaLink later). */
  syncCursor: string;
};

/** Result of a delta sync pass. */
export type MailChangeResult = {
  /** Deduplicated thread IDs added or modified since the cursor. */
  changedThreadIds: string[];
  /**
   * Provider message IDs the delta reports as removed from the synced inbox
   * scope (archived, deleted, or moved out). These entries carry only a message
   * ID — no thread ID — so the caller resolves each to its owning thread from
   * persisted data and re-sorts that thread, matching the Gmail path where an
   * INBOX-label removal re-surfaces the whole thread through {@link changedThreadIds}.
   * Gmail returns an empty list (it already folds removals into changedThreadIds);
   * the Outlook/Graph adapter populates it from `@removed` delta entries.
   */
  removedMessageIds: string[];
  /**
   * Optional provider hint: changed threads whose only delta activity is the
   * user's own outbound mail (sent, not in the inbox). The sync worker skips
   * fetching these when they are not already persisted, so a sent email awaiting
   * a reply is never imported. Providers without per-message label data (Outlook
   * via Graph, whose sync is already inbox-scoped) simply omit it.
   */
  sentOnlyCandidateThreadIds?: string[];
  /** New cursor to persist after processing. */
  newCursor: string;
};

/** Lightweight per-thread metadata returned by {@link MailProvider.listThreadsPage}. */
export type MailThreadMeta = {
  id: string;
  /** True if any message in the thread is unread. */
  unread: boolean;
  /** Timestamp of the most recent message in the thread. */
  latestMessageAt: Date;
  /**
   * Per-message provider label arrays, in message order. Used by the backfill
   * worker to compute thread-level flags (spam/promotions/trash) without a
   * second fetch. Empty for providers that do not expose labels.
   */
  messageLabelIds: string[][];
  /**
   * Per-message sender address (lowercased), in message order. Lets the backfill
   * worker detect sent-only threads by identity (the owner is the sole sender)
   * without a full fetch. Empty for providers whose metadata does not carry it
   * (Outlook, which is inbox-scoped and never sees a sent-only thread).
   */
  messageSenders: string[];
  /**
   * Per-message recipient addresses (lowercased To + Cc), in message order. Used
   * with {@link messageSenders} to keep notes-to-self importable at the metadata
   * stage. Empty for providers that do not carry it.
   */
  messageRecipients: string[][];
};

/** A page of thread metadata plus the resume token and total estimate. */
export type MailThreadPage = {
  threads: MailThreadMeta[];
  nextPageToken: string | undefined;
  /** Provider estimate of total matching threads across all pages (approximate). */
  resultSizeEstimate: number;
};

/** Result of registering a push watch/subscription. */
export type MailWatchResult = {
  /** Provider cursor captured at watch time (Gmail historyId). */
  cursor: string;
  /** Unix-ms timestamp (as a string) when the watch expires. */
  expiresAt: string;
};
