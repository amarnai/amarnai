import type { ThreadSnapshot } from "@aziru/ai";

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

  /**
   * Fetch the raw bytes of a single attachment (used to serve CID inline images
   * in the preview). `mimeType` is the provider-reported type where available
   * (Graph) or `null` (Gmail, whose attachment endpoint reports none) — callers
   * must not trust it for a response Content-Type; sniff the bytes instead.
   * Throws when the provider reports the attachment as gone; the image-proxy
   * route degrades any failure to a hidden image.
   */
  getAttachmentContent(
    providerMessageId: string,
    attachmentId: string
  ): Promise<MailAttachmentContent>;

  /** Register a push watch/subscription for this mailbox. */
  registerWatch(target: string): Promise<MailWatchResult>;

  /** Tear down the push watch/subscription (best-effort, before token revoke). */
  stopWatch(): Promise<void>;

  // ── Opt-in folder→label writeback ──────────────────────────────────────────
  // Only exercised when a workspace has enabled writeback AND granted the write
  // scope (gmail.modify / Mail.ReadWrite). Read-only providers/connections never
  // reach these; callers gate on grantedScopes first.

  /**
   * Idempotently ensure a provider-side label/category exists for each folder
   * def, applying the mapped color. Returns a map of node id → provider
   * identifier (Gmail label id; Outlook category display name). Never deletes or
   * renames anything — provisioning is additive in this slice.
   */
  ensureFolderLabels(defs: MailFolderLabelDef[]): Promise<Map<string, string>>;

  /**
   * Rename the label/category behind `providerLabelId` to the new path, so the
   * existing provider-side object — and every thread already carrying it —
   * follows a folder rename instead of being orphaned next to a duplicate.
   * Best-effort: a label already deleted, or a name conflict, is left for
   * {@link ensureFolderLabels} to resolve by name afterwards. Gmail renames in
   * place (label ids are stable across renames); Outlook cannot (Graph
   * master-category displayName is immutable), so there this is a no-op and the
   * old category stays on already-tagged messages.
   */
  renameFolderLabel(providerLabelId: string, pathSegments: string[]): Promise<void>;

  /**
   * Declaratively reconcile the Aziru-managed labels/categories on one thread:
   * after the call, of `managedLabelIds` exactly `desiredLabelIds` are present
   * (foreign labels/categories the user set are left untouched). Idempotent and
   * MUST make zero write calls when the thread already matches — that no-op is
   * what keeps our own writes from churning through history/delta sync.
   *
   * `messageIds` are the thread's provider message ids, for providers that label
   * per-message (Outlook categories); Gmail labels the thread and ignores them.
   */
  applyThreadFolderLabels(opts: MailApplyThreadLabelsOptions): Promise<void>;
}

/** One folder to mirror provider-side. Segments are pre-sanitized, root-first,
 *  and namespace-prefixed (the first segment is the "Aziru" namespace). */
export type MailFolderLabelDef = {
  /** Taxonomy node id — for the returned map and logging only. */
  nodeId: string;
  /** e.g. ["Aziru", "Clients", "Acme"]. Gmail joins on "/" (nesting); Outlook
   *  uses the joined string as a flat display name. */
  pathSegments: string[];
  /** A FOLDER_COLOR_KEYS member; the adapter maps it to a provider-native color. */
  colorKey: string;
};

/** Arguments for {@link MailProvider.applyThreadFolderLabels}. */
export type MailApplyThreadLabelsOptions = {
  /** Provider thread id (Gmail thread id / Outlook conversationId). */
  threadId: string;
  /** Provider message ids in the thread (used by per-message providers). */
  messageIds: string[];
  /** Managed label/category ids that SHOULD be on the thread after the call. */
  desiredLabelIds: string[];
  /** Every Aziru-managed label/category id, so foreign ones are preserved. */
  managedLabelIds: string[];
};

/** Raw bytes of one attachment, plus the provider's type hint (may be null). */
export type MailAttachmentContent = {
  data: Uint8Array;
  mimeType: string | null;
  size: number;
};

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
   * Provider message IDs the delta reports as removed from a synced folder
   * (archived, deleted, or moved out). These entries carry only a message
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
   * a reply is never imported.
   *
   * Both providers populate it, from different evidence: Gmail from per-message
   * SENT-without-INBOX labels, Outlook from a conversation that appeared in the
   * Sent Items delta but not the inbox delta.
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
