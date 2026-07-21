/**
 * One-off cleanup: remove already-imported "sent-only" Gmail threads — threads
 * whose every message was sent by the mailbox owner and which are not addressed
 * back to the owner (i.e. a sent email awaiting a reply, not a note-to-self).
 * These were imported before the sync/backfill pipeline learned to skip them.
 *
 * Message label IDs are not persisted, so sent-only is inferred from stored data:
 * every message's senderEmail equals the account's primaryEmailAddress AND the
 * owner appears in no message's To/Cc (approximating the SENT-without-INBOX rule
 * and protecting notes-to-self, which land in the inbox and stay).
 *
 * Conservative: only GMAIL accounts, and only threads with NO sign of human
 * interaction — unresolved, unassigned, not important, no manual-move reference,
 * no thread tag, no draft. AI classifications ARE removed along the way: they are
 * pure AI artifacts and quota is metered on the reset-immune InboxUsageMeter, not
 * on classification counts, so deleting them refunds nothing.
 *
 * Dry-run by default; pass --apply to delete. Idempotent: a second run matches
 * nothing. EmailThread has no cascading children, so dependents are deleted
 * explicitly, children first.
 *
 * Usage:
 *   pnpm --filter @amarnai/db cleanup-sent-only-threads          # dry run
 *   pnpm --filter @amarnai/db cleanup-sent-only-threads --apply  # delete
 */
import { db } from "../src/index.js";

const APPLY = process.argv.includes("--apply");
const BATCH = 500;

/** Defensive parse of a stored Json string[] (To/Cc) to lowercased addresses. */
function toAddressList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((v) => String(v).toLowerCase()) : [];
}

type ThreadRow = {
  id: string;
  subject: string | null;
  triageStatus: string;
  messages: Array<{ id: string; senderEmail: string; toEmails: unknown; ccEmails: unknown }>;
};

/**
 * True when every message was sent by `primary` and none is addressed back to
 * `primary` (To/Cc). Empty threads are never sent-only (they are excluded by the
 * query anyway).
 */
function isSentOnly(messages: ThreadRow["messages"], primary: string): boolean {
  const p = primary.toLowerCase();
  if (messages.length === 0) return false;
  return messages.every((m) => {
    if (m.senderEmail.toLowerCase() !== p) return false;
    const recipients = [...toAddressList(m.toEmails), ...toAddressList(m.ccEmails)];
    return !recipients.includes(p);
  });
}

async function main() {
  const accounts = await db.emailAccount.findMany({
    where: { provider: "GMAIL" },
    select: { id: true, primaryEmailAddress: true, workspaceId: true },
  });

  console.log(
    `[cleanup-sent-only] ${APPLY ? "APPLY" : "DRY RUN"} — scanning ${accounts.length} Gmail account(s)`
  );

  let totalDeleted = 0;

  for (const account of accounts) {
    let cursor: string | undefined;
    let accountDeleted = 0;

    for (;;) {
      const page: ThreadRow[] = await db.emailThread.findMany({
        where: {
          emailAccountId: account.id,
          // Human-interaction guards: never touch a thread anyone acted on.
          resolvedAt: null,
          assignedToUserId: null,
          isImportant: false,
          nodeReference: null,
          tags: { none: {} },
          drafts: { none: {} },
          messages: { some: {} },
        },
        select: {
          id: true,
          subject: true,
          triageStatus: true,
          messages: { select: { id: true, senderEmail: true, toEmails: true, ccEmails: true } },
        },
        orderBy: { id: "asc" },
        take: BATCH,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });

      if (page.length === 0) break;
      // Capture the paging boundary from the READ, before any deletion, so it is a
      // stable keyset value regardless of which rows this batch removes.
      cursor = page[page.length - 1]!.id;

      const sentOnly = page.filter((t) => isSentOnly(t.messages, account.primaryEmailAddress));

      for (const t of sentOnly) {
        console.log(
          `  ${account.primaryEmailAddress}  ws=${account.workspaceId}  thread=${t.id}  ` +
            `status=${t.triageStatus}  msgs=${t.messages.length}  subject=${JSON.stringify(t.subject)}`
        );
      }

      if (sentOnly.length > 0 && APPLY) {
        const ids = sentOnly.map((t) => t.id);
        const msgIds = sentOnly.flatMap((t) => t.messages.map((m) => m.id));
        await db.$transaction([
          db.emailTag.deleteMany({
            where: { OR: [{ emailThreadId: { in: ids } }, { emailMessageId: { in: msgIds } }] },
          }),
          db.emailClassification.deleteMany({ where: { emailThreadId: { in: ids } } }),
          db.emailMessage.deleteMany({ where: { emailThreadId: { in: ids } } }),
          db.emailThread.deleteMany({ where: { id: { in: ids } } }),
        ]);
      }

      accountDeleted += sentOnly.length;
      totalDeleted += sentOnly.length;
    }

    if (accountDeleted > 0) {
      console.log(
        `[cleanup-sent-only] ${account.primaryEmailAddress}: ` +
          `${APPLY ? "deleted" : "would delete"} ${accountDeleted} sent-only thread(s)`
      );
    }
  }

  console.log(
    `[cleanup-sent-only] Done. ${APPLY ? "Deleted" : "Would delete"} ${totalDeleted} thread(s) total.` +
      (APPLY ? "" : " Re-run with --apply to delete.")
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
