/**
 * One-off backfill: record whether each existing Outlook connection is a personal
 * Microsoft account or a work/school one.
 *
 * Outlook on the web is two hosts, and the work/school one (outlook.office.com)
 * refuses personal accounts outright with AADSTS500200 rather than redirecting
 * them. Connections made before `EmailConnection.outlookAccountType` existed have
 * no recorded type, so every mailbox URL built for them falls back to guessing
 * from the address — right for @outlook.com and friends, wrong for a personal
 * account registered on a custom domain.
 *
 * The answer is already in the data: Microsoft issues each message's `webLink` on
 * the host that serves that mailbox, so a single synced thread settles it. No
 * re-consent, no Graph call, no token refresh.
 *
 * Connections with nothing synced yet (or no recognisable webLink) are left null
 * and reported. They cost nothing: the URL builders keep guessing from the
 * address, and the next connect records the type from the sign-in token. Re-run
 * the script after a sync to pick them up.
 *
 * Idempotent: only rows with a null type are considered, and a run without
 * --apply writes nothing.
 *
 * Usage:
 *   pnpm --filter @aziru/worker backfill-outlook-account-type           # dry run
 *   pnpm --filter @aziru/worker backfill-outlook-account-type --apply   # write
 */
import { db } from "@aziru/db";
import { outlookAccountTypeFromWebLink, type OutlookAccountType } from "@aziru/core/emails";

const APPLY = process.argv.includes("--apply");

/** How many threads to look at before giving up on a workspace. A webLink host we
 *  do not recognise is possible (a sovereign cloud), so do not stop at the first. */
const THREAD_SAMPLE = 5;

async function accountTypeForWorkspace(
  workspaceId: string,
): Promise<OutlookAccountType | null> {
  const threads = await db.emailThread.findMany({
    where: { workspaceId, provider: "OUTLOOK", webLink: { not: null } },
    select: { webLink: true },
    orderBy: { id: "asc" },
    take: THREAD_SAMPLE,
  });
  for (const thread of threads) {
    const type = outlookAccountTypeFromWebLink(thread.webLink);
    if (type) return type;
  }
  return null;
}

async function main(): Promise<void> {
  const connections = await db.emailConnection.findMany({
    where: { provider: "OUTLOOK", outlookAccountType: null },
    select: { workspaceId: true, emailAddress: true },
    orderBy: { workspaceId: "asc" },
  });

  console.log(
    `[backfill-outlook-account-type] ${connections.length} Outlook connection(s) with no ` +
      `recorded account type.${APPLY ? "" : " Dry run."}`,
  );

  const stats = { personal: 0, organization: 0, unresolved: 0 };

  for (const connection of connections) {
    const type = await accountTypeForWorkspace(connection.workspaceId);
    if (!type) {
      stats.unresolved++;
      console.log(`  ${connection.emailAddress}: no usable webLink yet — left unset`);
      continue;
    }
    if (type === "PERSONAL") stats.personal++;
    else stats.organization++;

    console.log(`  ${connection.emailAddress}: ${type}${APPLY ? "" : " (not written)"}`);
    if (APPLY) {
      await db.emailConnection.update({
        where: { workspaceId: connection.workspaceId },
        data: { outlookAccountType: type },
      });
    }
  }

  console.log(
    `\n[backfill-outlook-account-type] Done. ${APPLY ? "Set" : "Would set"} ` +
      `${stats.personal} PERSONAL, ${stats.organization} ORGANIZATION; ` +
      `${stats.unresolved} left unset.` + (APPLY ? "" : " Re-run with --apply to write."),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
