import type { ThreadMessage } from "./types.js";

export type AttachmentMeta = {
  filename: string | null;
  mimeType: string;
  size: number | null;
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
  receivedAt: Date;
};

export type ThreadSnapshot = {
  provider: "gmail";
  providerThreadId: string;
  subject: string | null;
  participants: string[];
  latestMessageAt: Date;
  messageCount: number;
  messages: SnapshotMessage[];
};

export function snapshotToThreadMessages(snapshot: ThreadSnapshot): ThreadMessage[] {
  return snapshot.messages.map((m) => ({
    subject: m.subject,
    senderEmail: m.senderEmail,
    senderName: m.senderName,
    bodyText: m.bodyExcerpt,
    receivedAt: m.receivedAt,
  }));
}
