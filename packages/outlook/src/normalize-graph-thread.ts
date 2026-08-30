import type { ThreadSnapshot, SnapshotMessage, AttachmentMeta, InlineImageMeta } from "@aziru/ai";

// ─── Microsoft Graph message shapes (the fields we $select) ────────────────────

type GraphRecipient = { emailAddress?: { name?: string | null; address?: string | null } };

type GraphAttachment = {
  id?: string | null;
  name?: string | null;
  contentType?: string | null;
  size?: number | null;
  isInline?: boolean;
};

type GraphHeader = { name: string; value: string };

export type GraphMessage = {
  id: string;
  conversationId?: string;
  /**
   * Folder the message lives in. The client partitions on this to keep a thread
   * to the inbox + Sent Items and to drop junk / trash / archived copies; it is
   * not used here.
   */
  parentFolderId?: string;
  /** True for an unsent draft. Filtered out by the client before normalising. */
  isDraft?: boolean;
  from?: GraphRecipient;
  sender?: GraphRecipient;
  toRecipients?: GraphRecipient[];
  ccRecipients?: GraphRecipient[];
  subject?: string | null;
  receivedDateTime?: string;
  /** Set on Sent Items copies; the timestamp fallback when receivedDateTime is absent. */
  sentDateTime?: string;
  bodyPreview?: string | null;
  /** Graph strips quoted history from uniqueBody — preferred for the excerpt. */
  uniqueBody?: { contentType?: string; content?: string } | null;
  body?: { contentType?: string; content?: string } | null;
  hasAttachments?: boolean;
  attachments?: GraphAttachment[];
  internetMessageHeaders?: GraphHeader[];
  isRead?: boolean;
  webLink?: string | null;
};

// ─── Internal helpers ──────────────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function getHeader(headers: GraphHeader[] | undefined, name: string): string | null {
  if (!headers) return null;
  const lower = name.toLowerCase();
  return headers.find((h) => h.name.toLowerCase() === lower)?.value ?? null;
}

function recipientEmail(r: GraphRecipient | undefined): { email: string; name: string | null } {
  const email = (r?.emailAddress?.address ?? "").trim().toLowerCase();
  const name = r?.emailAddress?.name?.trim() || null;
  return { email, name };
}

function recipientEmails(list: GraphRecipient[] | undefined): string[] {
  return (list ?? [])
    .map((r) => (r.emailAddress?.address ?? "").trim().toLowerCase())
    .filter((e) => e.length > 0);
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * A message's position in the thread timeline. `receivedDateTime` is populated on
 * Sent Items copies too, but falls back to `sentDateTime` so the owner's own reply
 * can never sort to the epoch and drag `latestMessageAt` (or the newest-message
 * body budget) onto the wrong message.
 */
function messageTimestamp(msg: GraphMessage): Date {
  return parseDate(msg.receivedDateTime) ?? parseDate(msg.sentDateTime) ?? new Date(0);
}

function bodyExcerpt(msg: GraphMessage): string | null {
  // Prefer uniqueBody (quoted history already stripped by Graph), then body,
  // then the plaintext bodyPreview. HTML is stripped.
  //
  // Deliberately NOT truncated, matching the Gmail adapter. A cap here used to
  // read as a harmless classification bound, but this field is also what the
  // draft route sends to the model, and drafts budget 16,000 characters for the
  // message being replied to: an adapter-level 2,000-character cut meant Outlook
  // drafts were written from a fraction of the message while Gmail drafts saw all
  // of it. Every consumer (classification, summaries, drafts) applies its own
  // budget, so a second invisible limit here can only create provider drift.
  const source = msg.uniqueBody ?? msg.body;
  let text: string | null = null;
  if (source?.content) {
    text = source.contentType?.toLowerCase() === "html" ? stripHtml(source.content) : source.content.trim();
  } else if (msg.bodyPreview) {
    text = msg.bodyPreview.trim();
  }
  return text || null;
}

function attachments(msg: GraphMessage): AttachmentMeta[] {
  // Graph exposes isInline directly, so inline images are excluded without the
  // Content-ID walk the Gmail adapter needs.
  return (msg.attachments ?? [])
    .filter((a) => a.isInline !== true)
    .map((a) => ({
      filename: a.name ?? null,
      mimeType: a.contentType ?? "application/octet-stream",
      size: typeof a.size === "number" && a.size > 0 ? a.size : null,
    }));
}

function inlineImages(msg: GraphMessage): InlineImageMeta[] {
  // Graph flags inline parts directly; keep the inline images (with a fetchable
  // id) so the preview can request their bytes. Metadata only — no contentId
  // (it lives on the derived fileAttachment type, not the $select'd base type).
  return (msg.attachments ?? [])
    .filter((a) => a.isInline === true && !!a.id && (a.contentType ?? "").startsWith("image/"))
    .map((a) => ({
      attachmentId: a.id!,
      mimeType: a.contentType!,
      filename: a.name ?? null,
      size: typeof a.size === "number" && a.size > 0 ? a.size : null,
    }));
}

function normalizeMessage(msg: GraphMessage): SnapshotMessage {
  const { email: senderEmail, name: senderName } = recipientEmail(msg.from ?? msg.sender);

  return {
    providerMessageId: msg.id,
    senderEmail,
    senderName,
    toEmails: recipientEmails(msg.toRecipients),
    ccEmails: recipientEmails(msg.ccRecipients),
    subject: msg.subject ?? null,
    bodyExcerpt: bodyExcerpt(msg),
    attachments: attachments(msg),
    inlineImages: inlineImages(msg),
    receivedAt: messageTimestamp(msg),
    // Outlook has no Gmail label vocabulary, and folder membership is not a label:
    // the spam / trash / draft exclusions Gmail expresses with labels are applied
    // by GraphClient.getThreadSnapshot, which drops those folders before calling
    // here. Left empty, so the automated-mail detector relies on the
    // (provider-neutral) RFC header / no-reply / subject signals, which port
    // cleanly to Graph, and the label-based sent-only rule stays inert for Outlook
    // (its identity-based counterpart covers Outlook instead).
    labelIds: [],
    automatedHeaders: {
      listUnsubscribe: getHeader(msg.internetMessageHeaders, "List-Unsubscribe") !== null,
      listId: getHeader(msg.internetMessageHeaders, "List-Id") !== null,
      autoSubmitted: getHeader(msg.internetMessageHeaders, "Auto-Submitted"),
      precedence: getHeader(msg.internetMessageHeaders, "Precedence"),
    },
  };
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Group a conversation's Graph messages into one normalized {@link ThreadSnapshot}.
 * This is the inverse of Gmail (where one thread fetch returns all messages): the
 * caller has already gathered every message with the same `conversationId`.
 *
 * The caller is also responsible for deciding WHICH messages belong to the thread
 * — inbox + Sent Items, never drafts, junk, trash, or archived copies. Everything
 * passed in is treated as part of the conversation, including the owner's own
 * replies (which is what makes `messageCount` and `latestMessageAt` move when the
 * user replies, matching Gmail).
 *
 * `conversationId` is the thread key. Because it is not itself URL-resolvable, the
 * newest message's `webLink` is captured as the thread deep-link.
 */
export function normalizeGraphThread(
  rawMessages: GraphMessage[],
  conversationId: string,
): ThreadSnapshot {
  // Oldest-first so subject/participants mirror the Gmail adapter's ordering.
  const ordered = [...rawMessages].sort(
    (a, b) => messageTimestamp(a).getTime() - messageTimestamp(b).getTime(),
  );

  const messages: SnapshotMessage[] = ordered.map(normalizeMessage);
  const subject = messages[0]?.subject ?? null;

  const participantSet = new Set<string>();
  for (const m of messages) {
    if (m.senderEmail) participantSet.add(m.senderEmail.toLowerCase());
  }

  const latestMessageAt = messages.reduce<Date>(
    (latest, m) => (m.receivedAt > latest ? m.receivedAt : latest),
    new Date(0),
  );

  // Representative deep-link: the newest message with a webLink.
  const webLink =
    [...ordered].reverse().find((m) => m.webLink)?.webLink ?? null;

  return {
    provider: "outlook",
    providerThreadId: conversationId,
    subject,
    participants: Array.from(participantSet),
    latestMessageAt,
    messageCount: messages.length,
    messages,
    webLink,
  };
}
