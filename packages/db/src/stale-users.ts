import { db } from "./client.js";

// How old a never-verified, credential-less, workspace-less account must be
// before the sweep removes it. Long enough that a real user mid-signup (received
// the link, has not clicked yet) is never caught — verification links live 24h.
const STALE_UNVERIFIED_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Deletes abandoned registration rows: accounts that were never verified, never
// set a password, belong to no workspace, and are older than the TTL. These
// accumulate from /auth/register (and its web action) creating a row per new
// email even when the owner never returns; without a sweep the User table and
// its verification tokens grow unbounded (the row-exhaustion half of N12).
//
// Deleted per-row in its own transaction so one unexpected dangling reference
// (a relation this account should not have) skips that row instead of aborting
// the whole batch. Returns the number removed. Idempotent and retry-safe.
export async function deleteStaleUnverifiedUsers(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - STALE_UNVERIFIED_TTL_MS);

  const candidates = await db.user.findMany({
    where: {
      emailVerified: null,
      credential: null,
      createdAt: { lt: cutoff },
      ownedWorkspaces: { none: {} },
      workspaceMemberships: { none: {} },
    },
    select: { id: true },
  });

  let deleted = 0;
  for (const { id } of candidates) {
    try {
      await db.$transaction([
        // Verification tokens have no cascade; clear them before the user row.
        db.verificationToken.deleteMany({ where: { userId: id } }),
        // Refresh tokens cascade on user delete, but clear explicitly to be safe.
        db.refreshToken.deleteMany({ where: { userId: id } }),
        db.user.delete({ where: { id } }),
      ]);
      deleted++;
    } catch {
      // A relation not cleaned here still references the user (unexpected for a
      // never-verified, workspace-less account). Skip it — never let one row
      // block the sweep; a later run or manual teardown can handle it.
    }
  }
  return deleted;
}
