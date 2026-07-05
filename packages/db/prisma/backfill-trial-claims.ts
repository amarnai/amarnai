/**
 * Backfill: create a reset-immune TrialClaim for every existing user who has
 * already consumed their free trial (trialUsed = true), so the new email-hash
 * enforcement recognizes them after this deploy. Without this, a pre-existing
 * trial user could delete + re-register (or redeem a stockpiled checkout session)
 * for a second trial in the window before their claim exists.
 *
 * Idempotent (skipDuplicates) — safe to run multiple times.
 *
 * Usage:
 *   pnpm --filter @amarnai/db backfill-trial-claims
 */
import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { normalizeInboxKey } from "@amarnai/shared";

const db = new PrismaClient();

function trialEmailKeyHash(email: string): string {
  return crypto.createHash("sha256").update(normalizeInboxKey(email)).digest("hex");
}

async function main() {
  const PAGE = 1000;
  let cursor: string | undefined;
  let created = 0;
  let scanned = 0;

  for (;;) {
    const users = await db.user.findMany({
      where: { trialUsed: true },
      select: { id: true, email: true },
      orderBy: { id: "asc" },
      take: PAGE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (users.length === 0) break;
    scanned += users.length;

    const result = await db.trialClaim.createMany({
      data: users.map((u) => ({ emailKeyHash: trialEmailKeyHash(u.email), userId: u.id })),
      skipDuplicates: true,
    });
    created += result.count;

    cursor = users[users.length - 1]!.id;
    if (users.length < PAGE) break;
  }

  console.log(`Done. Scanned ${scanned} trial-consumed user(s); created ${created} new claim(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
