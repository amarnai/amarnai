import type { ThreadSnapshot, SnapshotMessage, AttachmentMeta, InlineImageMeta } from "@amarnai/ai";

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
  labelIds?: string[];
  snippet?: string;
  /** Gmail's server receive time, epoch milliseconds as a string. */
  internalDate?: string;
  payload: RawPart & { headers: RawHeader[] };
};

export type RawGmailThread = {
  id: string;
  historyId?: string;
  messages: RawMessage[];
};

// ─── Internal helpers ──────────────────────────────────────────────────────────

function decodeBase64Url(encoded: string): string {
  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return Buffer.from(padded, "base64").toString("utf8");
}

export function getHeader(headers: RawHeader[], name: string): string | null {
  const lower = name.toLowerCase();
  return headers.find((h) => h.name.toLowerCase() === lower)?.value ?? null;
}

export function parseFrom(value: string): { email: string; name: string | null } {
  const angleMatch = value.match(/^(.+?)\s*<([^>]+)>\s*$/);
  if (angleMatch) {
    const rawName = angleMatch[1]!.trim().replace(/^"|"$/g, "").trim();
    return { name: rawName || null, email: angleMatch[2]!.trim().toLowerCase() };
  }
  return { name: null, email: value.trim().toLowerCase() };
}

export function extractEmails(header: string): string[] {
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

function stripCidReferences(text: string): string {
  // Some clients (Apple Mail, Outlook) write literal [cid:...] markers in the
  // text/plain part to mark where inline images sit in the HTML version.
  return text.replace(/\[cid:[^\]]+\]/gi, "");
}

/**
 * Recursively extract the best plain-text body from a MIME part tree.
 * Prefers text/plain over text/html in multipart/alternative.
 */
function extractText(part: RawPart): string | null {
  if (part.mimeType === "text/plain") {
    const data = part.body.data;
    if (!data) return null;
    return stripCidReferences(decodeBase64Url(data));
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

// Normalise a Content-ID for comparison: strip angle brackets, whitespace, and
// lowercase. "<C3D8...@host>" and the body reference "cid:c3d8...@host" then match.
function normalizeCid(value: string): string {
  return value.trim().replace(/^<|>$/g, "").trim().toLowerCase();
}

/**
 * Collect every Content-ID referenced from the message body, which is the
 * ground-truth signal that an image is embedded inline rather than attached.
 * Two reference forms appear:
 *   - HTML bodies:  <img src="cid:abc@host">
 *   - plain bodies: [cid:abc@host]  (some clients mark inline images this way)
 * Quoted replies re-embed prior inline images, so this also matches images
 * that only appear inside the quoted history.
 */
function collectReferencedCids(part: RawPart, acc: Set<string>): void {
  if ((part.mimeType === "text/html" || part.mimeType === "text/plain") && part.body.data) {
    const text = decodeBase64Url(part.body.data);
    const re = /\bcid:([^"'\s)>\]]+)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      acc.add(normalizeCid(m[1]!));
    }
  }
  if (part.parts) {
    for (const p of part.parts) collectReferencedCids(p, acc);
  }
}

/**
 * Recursively collect attachment metadata from a MIME part tree.
 * Never fetches attachment content — metadata only.
 * Inline images are excluded: a part is inline when its Content-ID is actually
 * referenced by a cid: URL somewhere in the message body. Real attachments
 * (e.g. PDFs) are never referenced this way, so they are always kept even if
 * the client gave them a Content-ID or marked them Content-Disposition: inline.
 */
function extractAttachments(part: RawPart, referencedCids: Set<string>): AttachmentMeta[] {
  const result: AttachmentMeta[] = [];

  const isAttachment =
    (part.filename !== undefined && part.filename !== "") ||
    (part.body.attachmentId !== undefined && part.body.attachmentId !== "");

  const cidHeader = part.headers ? getHeader(part.headers, "Content-ID") : null;
  const isReferencedInline =
    cidHeader !== null && referencedCids.has(normalizeCid(cidHeader));

  if (
    isAttachment &&
    !isReferencedInline &&
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
      result.push(...extractAttachments(p, referencedCids));
    }
  }

  return result;
}

/**
 * Recursively collect CID inline images from a MIME part tree — the mirror of
 * {@link extractAttachments}: it keeps exactly the parts that function drops.
 * A part qualifies when it is an image with a fetchable `attachmentId` whose
 * Content-ID is actually referenced from the body (the same inline signal). Only
 * metadata is captured; content is fetched later via the image-proxy route.
 */
function extractInlineImages(part: RawPart, referencedCids: Set<string>): InlineImageMeta[] {
  const result: InlineImageMeta[] = [];

  const cidHeader = part.headers ? getHeader(part.headers, "Content-ID") : null;
  const normalizedCid = cidHeader !== null ? normalizeCid(cidHeader) : null;
  const isReferencedInline = normalizedCid !== null && referencedCids.has(normalizedCid);

  if (
    isReferencedInline &&
    part.mimeType.startsWith("image/") &&
    part.body.attachmentId !== undefined &&
    part.body.attachmentId !== ""
  ) {
    result.push({
      attachmentId: part.body.attachmentId,
      mimeType: part.mimeType,
      filename: part.filename || null,
      size: part.body.size > 0 ? part.body.size : null,
      contentId: normalizedCid,
    });
  }

  if (part.parts) {
    for (const p of part.parts) {
      result.push(...extractInlineImages(p, referencedCids));
    }
  }

  return result;
}

/**
 * Per-message receive time from Gmail's server-authoritative `internalDate`
 * (epoch ms), NOT the sender-controlled `Date:` header. The header is spoofable
 * and often missing on bulk mail; `internalDate` is unspoofable and matches both
 * the metadata path (fetchThreadMetaForIds) and the Outlook adapter's server
 * receive time, so ordering is consistent across paths and providers.
 */
function parseReceivedAt(internalDate: string | undefined): Date {
  if (!internalDate) return new Date(0);
  const d = new Date(Number(internalDate));
  return isNaN(d.getTime()) ? new Date(0) : d;
}

function normalizeMessage(msg: RawMessage): SnapshotMessage {
  const headers = msg.payload.headers;

  const fromRaw = getHeader(headers, "From") ?? "";
  const { email: senderEmail, name: senderName } = parseFrom(fromRaw);

  const toRaw = getHeader(headers, "To") ?? "";
  const ccRaw = getHeader(headers, "Cc") ?? "";

  const subject = getHeader(headers, "Subject") ?? null;
  const receivedAt = parseReceivedAt(msg.internalDate);

  const rawText = extractText(msg.payload);
  let bodyExcerpt: string | null = null;
  if (rawText) {
    const stripped = stripQuotedReply(rawText);
    bodyExcerpt = stripped || null;
  }

  const referencedCids = new Set<string>();
  collectReferencedCids(msg.payload, referencedCids);
  const attachments = extractAttachments(msg.payload, referencedCids);
  const inlineImages = extractInlineImages(msg.payload, referencedCids);

  // Bulk/automation markers — presence flags + raw values for the detector.
  const automatedHeaders = {
    listUnsubscribe: getHeader(headers, "List-Unsubscribe") !== null,
    listId: getHeader(headers, "List-Id") !== null,
    autoSubmitted: getHeader(headers, "Auto-Submitted"),
    precedence: getHeader(headers, "Precedence"),
  };

  return {
    providerMessageId: msg.id,
    senderEmail,
    senderName,
    toEmails: extractEmails(toRaw),
    ccEmails: extractEmails(ccRaw),
    subject,
    bodyExcerpt,
    attachments,
    inlineImages,
    receivedAt,
    labelIds: msg.labelIds ?? [],
    automatedHeaders,
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
