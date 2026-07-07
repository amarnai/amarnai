import { db } from "@amarnai/db";
import type { SnapshotMessage } from "@amarnai/ai";
import type { ThreadLabelFlags } from "./filter-thread-messages.js";

/**
 * Upsert the EmailThread row for a fetched thread. Shared by the live sync and
 * the historical backfill, which persist threads identically. Provider-neutral —
 * the caller passes the connection's provider so the row is stamped correctly.
 *
 * `updateContent` distinguishes the two write shapes:
 *  - true  — an included (kept) thread: refresh subject / latestMessageAt /
 *            messageCount alongside the label flags.
 *  - false — an excluded thread: only the label flags change. The row is kept so
 *            query-time filtering can hide it, but its content fields are left
 *            untouched (the unfiltered snapshot's subject/date are persisted on
 *            create only).
 *
 * The create payload is identical for both. Returns the thread's internal id.
 */
export async function upsertEmailThread(opts: {
  workspaceId: string;
  emailAccountId: string;
  provider: "GMAIL" | "OUTLOOK";
  providerThreadId: string;
  subject: string | null;
  latestMessageAt: Date;
  messageCount: number;
  labelFlags: ThreadLabelFlags;
  updateContent: boolean;
  // Representative deep-link (Outlook conversationId is not URL-resolvable).
  // Undefined for Gmail; only written when provided so it is never nulled.
  webLink?: string | null | undefined;
}): Promise<string> {
  const {
    workspaceId,
    emailAccountId,
    provider,
    providerThreadId,
    subject,
    latestMessageAt,
    messageCount,
    labelFlags,
    updateContent,
    webLink,
  } = opts;

  // Only include webLink in the write when the adapter supplied one, so a Gmail
  // sync never overwrites a stored link with null.
  const webLinkData = webLink != null ? { webLink } : {};

  const thread = await db.emailThread.upsert({
    where: {
      emailAccountId_providerThreadId: { emailAccountId, providerThreadId },
    },
    create: {
      workspaceId,
      emailAccountId,
      provider,
      providerThreadId,
      subject,
      latestMessageAt,
      messageCount,
      ...webLinkData,
      ...labelFlags,
    },
    update: updateContent
      ? { subject, latestMessageAt, messageCount, ...webLinkData, ...labelFlags }
      : { ...webLinkData, ...labelFlags },
    select: { id: true },
  });

  return thread.id;
}

/**
 * Upsert a thread's messages — metadata only, body text is never persisted.
 * Shared by the live sync and the historical backfill. The caller owns any
 * surrounding concerns (message-deletion diffing, classification), so this helper
 * only writes the rows.
 */
export async function upsertEmailMessages(opts: {
  workspaceId: string;
  emailAccountId: string;
  emailThreadId: string;
  messages: SnapshotMessage[];
}): Promise<void> {
  const { workspaceId, emailAccountId, emailThreadId, messages } = opts;

  for (const msg of messages) {
    const snippet = msg.bodyExcerpt ? msg.bodyExcerpt.slice(0, 200) : null;
    await db.emailMessage.upsert({
      where: {
        emailAccountId_providerMessageId: {
          emailAccountId,
          providerMessageId: msg.providerMessageId,
        },
      },
      create: {
        workspaceId,
        emailAccountId,
        emailThreadId,
        providerMessageId: msg.providerMessageId,
        senderEmail: msg.senderEmail,
        senderName: msg.senderName,
        toEmails: msg.toEmails,
        ccEmails: msg.ccEmails,
        bccEmails: [],
        subject: msg.subject,
        snippet,
        bodyText: null,
        receivedAt: msg.receivedAt,
        hasAttachments: msg.attachments.length > 0,
        attachments: msg.attachments.map(({ filename, mimeType }) => ({ filename, mimeType })),
      },
      update: {
        senderName: msg.senderName,
        snippet,
        hasAttachments: msg.attachments.length > 0,
        attachments: msg.attachments.map(({ filename, mimeType }) => ({ filename, mimeType })),
      },
      select: { id: true },
    });
  }
}
