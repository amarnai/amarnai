/**
 * Backfill: ensure every workspace has its mandatory taxonomy nodes — the Inbox
 * root and the catch-all ("Updates / Other") leaf with its root edge. Reuses the
 * same idempotent `ensureInboxTaxonomy` used by all workspace-creation paths, so
 * it only creates what is missing and is safe to run multiple times.
 *
 * Forward-only: this creates the catch-all node but does NOT re-sort any
 * existing threads. Workspaces with bulk routing enabled (the default) will
 * start auto-filing future automated/bulk mail to the catch-all.
 *
 * Usage:
 *   pnpm --filter @aziru/db backfill-catch-all
 */
import { db, ensureInboxTaxonomy } from "../src/index.js";

async function main() {
  const workspaces = await db.workspace.findMany({ select: { id: true, name: true } });

  console.log(`Checking ${workspaces.length} workspace(s) for missing catch-all node…`);

  let backfilled = 0;
  for (const ws of workspaces) {
    const hasCatchAll = await db.taxonomyNode.findFirst({
      where: { workspaceId: ws.id, isCatchAll: true },
      select: { id: true },
    });
    if (hasCatchAll) continue;

    await ensureInboxTaxonomy(ws.id);
    backfilled++;
    console.log(`  Seeded catch-all for workspace: "${ws.name}" (${ws.id})`);
  }

  console.log(`Done. Backfilled ${backfilled} catch-all node(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
