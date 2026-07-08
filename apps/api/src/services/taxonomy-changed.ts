import { db } from "@amarnai/db";

/**
 * A Prisma client or interactive-transaction client — anything exposing
 * `workspace.update`. Lets bump sites pass either the shared `db` or the `tx`
 * handle inside an interactive transaction.
 */
type WorkspaceUpdater = {
  workspace: { update: (args: { where: { id: string }; data: { taxonomyChangedAt: Date } }) => unknown };
};

/**
 * Stamp `Workspace.taxonomyChangedAt` to now. Call after any routing-relevant
 * taxonomy mutation (node create/delete, name or description edit, edge change,
 * full import). This is the single signal the NEEDS_REVIEW re-sort banner reads
 * to decide which review threads may route differently now.
 *
 * Best-effort when called outside a transaction: a failed bump must never fail
 * the user's edit (the re-sort banner is a convenience, not a correctness gate).
 * Pass the `tx` handle to make the bump atomic with the mutation instead.
 */
export async function bumpTaxonomyChangedAt(
  workspaceId: string,
  client: WorkspaceUpdater = db,
): Promise<void> {
  await client.workspace.update({
    where: { id: workspaceId },
    data: { taxonomyChangedAt: new Date() },
  });
}
