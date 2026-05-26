import type { ThreadSnapshot, SnapshotMessage, AttachmentMeta } from "@amarnai/ai";

// ─── Gmail API response types ──────────────────────────────────────────────────

type RawHeader = { name: string; value: string };

type RawPart = {
  mimeType: string;
  filename?: string;
  headers?: RawHeader[];
  body: { size: number; data?: string; attachmentId?: string };
  parts?: RawPart[];
};

type RawMessage = {
  id: string;
  threadId: string;
  snippet?: string;
  payload: RawPart & { headers: RawHeader[] };
};

export type RawGmailThread = {
  id: string;
  historyId?: string;
  messages: RawMessage[];
};

// ─── Internal helpers ──────────────────────────────────────────────────────────

const BODY_EXCERPT_MAX = 2000;

function decodeBase64Url(encoded: string): string {
  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return Buffer.from(padded, "base64").toString("utf8");
}

function getHeader(headers: RawHeader[], name: string): string | null {
  const lower = name.toLowerCase();
  return headers.find((h) => h.name.toLowerCase() === lower)?.value ?? null;
}

function parseFrom(value: string): { email: string; name: string | null } {
  const angleMatch = value.match(/^(.+?)\s*<([^>]+)>\s*$/);
  if (angleMatch) {
    const rawName = angleMatch[1]!.trim().replace(/^"|"$/g, "").trim();
    return { name: rawName || null, email: angleMatch[2]!.trim().toLowerCase() };
  }
  return { name: null, email: value.trim().toLowerCase() };
}

function extractEmails(header: string): string[] {
  const matches = header.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g);
  return matches ?? [];
}

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

/**
 * Strip quoted replies using common email conventions.
 * Returns everything before the first quoted block indicator.
 */
function stripQuotedReply(text: string): string {
  const lines = text.split("\n");
  let cutLine = lines.length;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();
    if (
      trimmed.startsWith(">") ||
      /^On .{10,} wrote:$/.test(trimmed) ||
      /^-----Original Message-----/.test(trimmed) ||
      /^_{5,}$/.test(trimmed)
    ) {
      // Back up past any blank lines just before the quote
      cutLine = i;
      while (cutLine > 0 && lines[cutLine - 1]!.trim() === "") cutLine--;
      break;
    }
  }

  return lines.slice(0, cutLine).join("\n").trim();
}

/**
 * Recursively extract the best plain-text body from a MIME part tree.
 * Prefers text/plain over text/html in multipart/alternative.
 */
function extractText(part: RawPart): string | null {
  if (part.mimeType === "text/plain") {
    const data = part.body.data;
    if (!data) return null;
    return decodeBase64Url(data);
  }

  if (part.mimeType === "text/html") {
    const data = part.body.data;
    if (!data) return null;
    return stripHtml(decodeBase64Url(data));
  }

  if (part.mimeType.startsWith("multipart/") && part.parts) {
    if (part.mimeType === "multipart/alternative") {
      // Prefer text/plain
      for (const p of part.parts) {
        if (p.mimeType === "text/plain") {
          const t = extractText(p);
          if (t) return t;
        }
      }
      // Fall back to text/html
      for (const p of part.parts) {
        if (p.mimeType === "text/html") {
          const t = extractText(p);
          if (t) return t;
        }
      }
    }

    // multipart/mixed, multipart/related, etc. — recurse and take first match
    for (const p of part.parts) {
      const t = extractText(p);
      if (t) return t;
    }
  }

  return null;
}

/**
 * Recursively collect attachment metadata from a MIME part tree.
 * Never fetches attachment content — metadata only.
 */
function extractAttachments(part: RawPart): AttachmentMeta[] {
  const result: AttachmentMeta[] = [];

  const isAttachment =
    (part.filename !== undefined && part.filename !== "") ||
    (part.body.attachmentId !== undefined && part.body.attachmentId !== "");

  if (
    isAttachment &&
    !part.mimeType.startsWith("text/") &&
    !part.mimeType.startsWith("multipart/")
  ) {
    result.push({
      filename: part.filename ?? null,
      mimeType: part.mimeType,
      size: part.body.size > 0 ? part.body.size : null,
    });
  }

  if (part.parts) {
    for (const p of part.parts) {
      result.push(...extractAttachments(p));
    }
  }

  return result;
}

function parseReceivedAt(dateHeader: string | null): Date {
  if (!dateHeader) return new Date(0);
  const d = new Date(dateHeader);
  return isNaN(d.getTime()) ? new Date(0) : d;
}

function normalizeMessage(msg: RawMessage): SnapshotMessage {
  const headers = msg.payload.headers;

  const fromRaw = getHeader(headers, "From") ?? "";
  const { email: senderEmail, name: senderName } = parseFrom(fromRaw);

  const toRaw = getHeader(headers, "To") ?? "";
  const ccRaw = getHeader(headers, "Cc") ?? "";

  const subject = getHeader(headers, "Subject") ?? null;
  const dateHeader = getHeader(headers, "Date");
  const receivedAt = parseReceivedAt(dateHeader);

  const rawText = extractText(msg.payload);
  let bodyExcerpt: string | null = null;
  if (rawText) {
    const stripped = stripQuotedReply(rawText);
    const bounded = stripped.length > BODY_EXCERPT_MAX
      ? stripped.slice(0, BODY_EXCERPT_MAX) + " [truncated]"
      : stripped;
    bodyExcerpt = bounded || null;
  }

  const attachments = extractAttachments(msg.payload);

  return {
    providerMessageId: msg.id,
    senderEmail,
    senderName,
    toEmails: extractEmails(toRaw),
    ccEmails: extractEmails(ccRaw),
    subject,
    bodyExcerpt,
    attachments,
    receivedAt,
  };
}

// ─── Public API ────────────────────────────────────────────────────────────────

export function normalizeGmailThread(raw: unknown): ThreadSnapshot {
  const thread = raw as RawGmailThread;

  const messages: SnapshotMessage[] = (thread.messages ?? []).map(normalizeMessage);

  const subject = messages[0]?.subject ?? null;

  const participantSet = new Set<string>();
  for (const m of messages) {
    if (m.senderEmail) participantSet.add(m.senderEmail.toLowerCase());
  }
  const participants = Array.from(participantSet);

  const latestMessageAt = messages.reduce<Date>(
    (latest, m) => (m.receivedAt > latest ? m.receivedAt : latest),
    new Date(0)
  );

  return {
    provider: "gmail",
    providerThreadId: thread.id,
    subject,
    participants,
    latestMessageAt,
    messageCount: messages.length,
    messages,
  };
}
