/**
 * Snapshot types for normalised Gmail thread data, and a converter to the
 * `ThreadMessage[]` format consumed by the AI classifiers.
 *
 * `ThreadSnapshot` is the normalised representation produced by the Gmail
 * thread adapter. `SnapshotMessage.bodyExcerpt` is already truncated and
 * stripped of quoted replies — it is safe to pass directly to LLMs.
 */
import type { ThreadMessage } from "./types.js";

export type AttachmentMeta = {
  filename: string | null;
  mimeType: string;
  size: number | null;
};

/**
 * A CID-referenced inline image part (embedded signature/logo/photo). Metadata
 * only — the image bytes are never captured here, never persisted, and never
 * sent to LLMs. Fetched on demand per-view via the image-proxy route using
 * {@link providerMessageId} (on the owning {@link SnapshotMessage}) + `attachmentId`.
 */
export type InlineImageMeta = {
  attachmentId: string;
  mimeType: string;
  filename: string | null;
  size: number | null;
  /** The normalized Content-ID (Gmail only, informational); absent for Outlook. */
  contentId?: string | null;
};

export type SnapshotMessage = {
  providerMessageId: string;
  senderEmail: string;
  senderName: string | null;
  toEmails: string[];
  ccEmails: string[];
  subject: string | null;
  /** Bounded plain-text excerpt for classification. Max 2000 chars. No HTML. Quoted replies stripped. */
  bodyExcerpt: string | null;
  attachments: AttachmentMeta[];
  /**
   * CID-referenced inline images on this message (metadata only). Optional —
   * populated only on full-fetch paths that parse body content; absent on
   * metadata-only paths. Never persisted, never passed to classifiers
   * ({@link snapshotToThreadMessages} ignores it).
   */
  inlineImages?: InlineImageMeta[];
  receivedAt: Date;
  /** Gmail label IDs on this message (e.g. ["INBOX","SPAM","UNREAD"]). Optional — only populated when label data is available from the provider. */
  labelIds?: string[];
  /**
   * Bulk/automation header markers parsed from the raw headers. Optional —
   * only populated on full-fetch paths (absent on metadata-only paths, where
   * automation is detected from labels alone). Consumed by the automated-mail
   * detector; never contains email content.
   */
  automatedHeaders?: {
    listUnsubscribe: boolean;
    listId: boolean;
    autoSubmitted: string | null;
    precedence: string | null;
  };
};

export type ThreadSnapshot = {
  provider: "gmail" | "outlook";
  providerThreadId: string;
  subject: string | null;
  participants: string[];
  latestMessageAt: Date;
  messageCount: number;
  messages: SnapshotMessage[];
  /**
   * A representative message deep-link for the thread. Populated for providers
   * whose thread id is not itself URL-resolvable (Outlook `conversationId`): the
   * adapter captures one message's `webLink` so the app can open the thread.
   * Undefined for Gmail, where `providerThreadId` doubles as the deep-link key.
   */
  webLink?: string | null;
};

/**
 * True when a message is an unsent draft sitting in the thread.
 *
 * Gmail's `threads.get` returns drafts alongside real messages, so a reply the
 * user (or Amarnai Reply) has composed but not sent arrives in every snapshot of
 * that thread. A draft is not part of the conversation: it must never be
 * persisted, classified, summarised, or treated as the message being replied to.
 *
 * Outlook is unaffected — the Graph adapter is inbox-folder-scoped and drafts
 * live in the Drafts folder, so nothing there ever carries this label (its
 * normalizer emits `labelIds: []`, which is never a draft).
 */
export function isDraftMessage(msg: Pick<SnapshotMessage, "labelIds">): boolean {
  return (msg.labelIds ?? []).includes("DRAFT");
}

export function snapshotToThreadMessages(snapshot: ThreadSnapshot): ThreadMessage[] {
  return snapshot.messages.map((m) => ({
    subject: m.subject,
    senderEmail: m.senderEmail,
    senderName: m.senderName,
    bodyText: m.bodyExcerpt,
    receivedAt: m.receivedAt,
    attachmentNames: m.attachments.flatMap((a) => (a.filename ? [a.filename] : [])),
  }));
}
