/**
 * Backfill: create an Inbox root TaxonomyNode for every workspace that
 * does not already have one. Safe to run multiple times (idempotent).
 *
 * Usage:
 *   pnpm --filter @aziru/db backfill-inbox
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const workspaces = await db.workspace.findMany({
    select: { id: true, name: true },
  });

  console.log(`Checking ${workspaces.length} workspace(s) for missing Inbox node…`);

  let created = 0;
  for (const ws of workspaces) {
    const hasRoot = await db.taxonomyNode.findFirst({
      where: { workspaceId: ws.id, isRoot: true },
      select: { id: true },
    });
    if (!hasRoot) {
      await db.taxonomyNode.create({
        data: {
          workspaceId: ws.id,
          name: "Inbox",
          isRoot: true,
        },
      });
      created++;
      console.log(`  Created Inbox for workspace: "${ws.name}" (${ws.id})`);
    }
  }

  console.log(`Done. Created ${created} Inbox node(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
