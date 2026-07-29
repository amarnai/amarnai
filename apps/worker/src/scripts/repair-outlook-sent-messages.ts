/**
 * One-off repair: pull the mailbox owner's own replies into already-imported
 * Outlook threads.
 *
 * Until the Graph snapshot was widened past the inbox folder, `getThreadSnapshot`
 * returned only what the other party sent: the owner's replies live in Sent Items
 * and were never fetched, stored, classified, or summarised. Widening the query
 * fixes every FUTURE snapshot, but it repairs nothing on its own, because
 * `sync-inbox` is the only job that writes EmailMessage rows and it only runs for
 * threads the INBOX delta reports as changed. A reply the user sent produces no
 * inbox change, so an existing thread would keep its half-conversation until (and
 * unless) a brand-new inbound message happened to arrive on it.
 *
 * This script closes that gap once. It re-fetches each Outlook thread's snapshot
 * and upserts the messages that are missing.
 *
 * ADDITIVE ONLY. It never deletes a stored message, so it cannot be confused with
 * sync's removal diff: a row for a message that has since been archived is left
 * alone rather than cleaned up here. It also does NOT re-classify. Routing input
 * genuinely changed for repaired threads, but re-sorting every historical Outlook
 * thread would re-pay the embedding + LLM cost for the whole mailbox and consume
 * plan quota; that is a deliberate, separate decision. Thread summaries need no
 * action: they are keyed on the message-set signature and regenerate on next open.
 *
 * Idempotent: a second run finds nothing to add. Threads gone from the inbox
 * (fully archived or deleted) surface as MailThreadNotFoundError and are skipped,
 * exactly as the sync loop skips them.
 *
 * Usage:
 *   pnpm --filter @amarnai/worker repair-outlook-sent           # dry run
 *   pnpm --filter @amarnai/worker repair-outlook-sent --apply   # write
 *   pnpm --filter @amarnai/worker repair-outlook-sent --workspace=<id> --apply
 */
import { db } from "@amarnai/db";
import { createMailProvider, MailAuthError, MailThreadNotFoundError } from "@amarnai/mail";
import type { GmailSyncSettings } from "@amarnai/shared";
import { applyThreadFilter } from "../jobs/filter-thread-messages.js";
import { upsertEmailMessages } from "../jobs/persist-thread.js";

const APPLY = process.argv.includes("--apply");
const ONLY_WORKSPACE = process.argv
  .find((a) => a.startsWith("--workspace="))
  ?.split("=")[1];
const BATCH = 200;

/** Graph throttles harder than Gmail; pace the per-thread snapshot fetches. */
const THREAD_DELAY_MS = 120;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * `skipped` is an expected, benign outcome (the thread is gone from the inbox,
 * or filtered out); `failed` is not (a Graph error, most likely throttling).
 * Counted apart on purpose: folded together, a throttled run that repaired
 * almost nothing is indistinguishable from a clean run over an archived
 * mailbox, and the operator has no reason to re-run.
 */
async function repairWorkspace(workspaceId: string): Promise<{
  scanned: number;
  repaired: number;
  added: number;
  skipped: number;
  failed: number;
}> {
  const stats = { scanned: 0, repaired: 0, added: 0, skipped: 0, failed: 0 };

  const [connection, syncSettingsRow, account] = await Promise.all([
    db.emailConnection.findUnique({
      where: { workspaceId },
      select: { provider: true, emailAddress: true, subjectId: true, encryptedRefreshToken: true, status: true, grantedScopes: true },
    }),
    db.gmailSyncSettings.findUnique({
      where: { workspaceId },
      select: { includeSpam: true, includePromotions: true, blacklistedSenderEmails: true },
    }),
    db.emailAccount.findFirst({
      where: { workspaceId, provider: "OUTLOOK" },
      select: { id: true, primaryEmailAddress: true },
    }),
  ]);

  if (!connection || connection.provider !== "OUTLOOK") return stats;
  if (!account) return stats;
  if (connection.status !== "ACTIVE") {
    console.log(`  ${connection.emailAddress}: connection not ACTIVE — skipping`);
    return stats;
  }

  // Only the two fields applyThreadFilter actually reads matter here; the rest
  // satisfy the shared type. Mirrors how sync-inbox builds its settings.
  const settings: GmailSyncSettings = {
    includeSpam: syncSettingsRow?.includeSpam ?? false,
    includePromotions: syncSettingsRow?.includePromotions ?? false,
    sortingPaused: false,
    routeBulkToOther: true,
    labelWritebackEnabled: false,
    threadSummaryInjectionEnabled: true,
    replyButtonInjectionEnabled: true,
    injectedPanelEnabled: true,
    blacklistedSenderEmails: syncSettingsRow?.blacklistedSenderEmails ?? [],
  };

  const client = createMailProvider(connection);
  let cursor: string | undefined;

  for (;;) {
    const page = await db.emailThread.findMany({
      where: { emailAccountId: account.id },
      select: {
        id: true,
        providerThreadId: true,
        subject: true,
        messageCount: true,
        messages: { select: { providerMessageId: true } },
      },
      orderBy: { id: "asc" },
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (page.length === 0) break;
    cursor = page[page.length - 1]!.id;

    for (const thread of page) {
      stats.scanned++;

      // Paced BEFORE the fetch, not after the write: every thread costs a Graph
      // snapshot whether or not it needs repairing, and on a re-run (or a dry
      // run of an already-clean mailbox) none of them do. Pacing only the
      // repaired threads left the common path unthrottled, which Graph answers
      // with 429s that land in the generic catch below and are counted as
      // `skipped` — an under-repair that reads as success.
      await sleep(THREAD_DELAY_MS);

      let raw;
      try {
        raw = await client.getThreadSnapshot(thread.providerThreadId);
      } catch (err) {
        if (err instanceof MailThreadNotFoundError) {
          stats.skipped++;
          continue;
        }
        if (err instanceof MailAuthError) throw err; // reconnect needed; abort loudly
        console.log(`  thread=${thread.id} fetch failed: ${String(err).slice(0, 160)}`);
        stats.failed++;
        continue;
      }

      const snapshot = applyThreadFilter(raw, settings);
      if (snapshot === null) {
        stats.skipped++;
        continue;
      }

      const stored = new Set(thread.messages.map((m) => m.providerMessageId));
      const missing = snapshot.messages.filter((m) => !stored.has(m.providerMessageId));
      if (missing.length === 0) continue;

      stats.repaired++;
      stats.added += missing.length;
      const ownerAdded = missing.filter(
        (m) => m.senderEmail.toLowerCase() === account.primaryEmailAddress.toLowerCase(),
      ).length;
      console.log(
        `  thread=${thread.id} +${missing.length} message(s) ` +
          `(${ownerAdded} from the owner) ${thread.messageCount} -> ${snapshot.messageCount}`,
      );

      if (APPLY) {
        await upsertEmailMessages({
          workspaceId,
          emailAccountId: account.id,
          emailThreadId: thread.id,
          messages: missing,
        });
        // Keep the thread header consistent with the messages now under it, the
        // same two fields sync writes. A reply moving latestMessageAt forward is
        // correct and matches Gmail.
        await db.emailThread.update({
          where: { id: thread.id },
          data: {
            messageCount: snapshot.messageCount,
            latestMessageAt: snapshot.latestMessageAt,
          },
        });
      }
    }
  }

  return stats;
}

async function main() {
  const connections = await db.emailConnection.findMany({
    where: { provider: "OUTLOOK", ...(ONLY_WORKSPACE ? { workspaceId: ONLY_WORKSPACE } : {}) },
    select: { workspaceId: true, emailAddress: true },
  });

  console.log(
    `[repair-outlook-sent] ${APPLY ? "APPLY" : "DRY RUN"} — ` +
      `${connections.length} Outlook workspace(s)`,
  );

  const total = { scanned: 0, repaired: 0, added: 0, skipped: 0, failed: 0 };
  for (const conn of connections) {
    console.log(`\n${conn.emailAddress} (ws=${conn.workspaceId})`);
    const s = await repairWorkspace(conn.workspaceId);
    total.scanned += s.scanned;
    total.repaired += s.repaired;
    total.added += s.added;
    total.skipped += s.skipped;
    total.failed += s.failed;
    console.log(
      `  scanned=${s.scanned} repaired=${s.repaired} added=${s.added} ` +
        `skipped=${s.skipped} failed=${s.failed}`,
    );
  }

  console.log(
    `\n[repair-outlook-sent] Done. ${APPLY ? "Added" : "Would add"} ${total.added} message(s) ` +
      `across ${total.repaired} thread(s); scanned ${total.scanned}, skipped ${total.skipped}, ` +
      `failed ${total.failed}.` +
      (APPLY ? "" : " Re-run with --apply to write."),
  );

  // The run is only complete if nothing errored. Re-running is safe (additive
  // and idempotent), so say so rather than leaving a partial repair looking done.
  if (total.failed > 0) {
    console.warn(
      `\n[repair-outlook-sent] ${total.failed} thread(s) could not be fetched — this repair is ` +
        `INCOMPLETE. Graph throttling is the usual cause; re-run to pick them up ` +
        `(threads already repaired are skipped).`,
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
