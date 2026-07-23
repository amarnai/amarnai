import type { ThreadSnapshot, SnapshotMessage, AttachmentMeta, InlineImageMeta } from "@amarnai/ai";

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
  from?: GraphRecipient;
  sender?: GraphRecipient;
  toRecipients?: GraphRecipient[];
  ccRecipients?: GraphRecipient[];
  subject?: string | null;
  receivedDateTime?: string;
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

/** Max characters kept for the classification excerpt (matches the Gmail adapter). */
const BODY_EXCERPT_MAX = 2000;

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

function parseReceivedAt(value: string | undefined): Date {
  if (!value) return new Date(0);
  const d = new Date(value);
  return isNaN(d.getTime()) ? new Date(0) : d;
}

function bodyExcerpt(msg: GraphMessage): string | null {
  // Prefer uniqueBody (quoted history already stripped by Graph), then body,
  // then the plaintext bodyPreview. HTML is stripped; the result is bounded.
  const source = msg.uniqueBody ?? msg.body;
  let text: string | null = null;
  if (source?.content) {
    text = source.contentType?.toLowerCase() === "html" ? stripHtml(source.content) : source.content.trim();
  } else if (msg.bodyPreview) {
    text = msg.bodyPreview.trim();
  }
  if (!text) return null;
  const bounded = text.length > BODY_EXCERPT_MAX ? text.slice(0, BODY_EXCERPT_MAX) : text;
  return bounded || null;
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
    receivedAt: parseReceivedAt(msg.receivedDateTime),
    // Outlook sync is inbox-folder-scoped, so spam/trash never reach here and
    // there is no Gmail-category vocabulary. Left empty: the automated-mail
    // detector then relies on the (provider-neutral) RFC header / no-reply /
    // subject signals, which port cleanly to Graph.
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
 * `conversationId` is the thread key. Because it is not itself URL-resolvable, the
 * newest message's `webLink` is captured as the thread deep-link.
 */
export function normalizeGraphThread(
  rawMessages: GraphMessage[],
  conversationId: string,
): ThreadSnapshot {
  // Oldest-first so subject/participants mirror the Gmail adapter's ordering.
  const ordered = [...rawMessages].sort(
    (a, b) => parseReceivedAt(a.receivedDateTime).getTime() - parseReceivedAt(b.receivedDateTime).getTime(),
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
