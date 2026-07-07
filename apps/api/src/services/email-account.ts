import { db } from "@amarnai/db";

/**
 * Resolve the EmailAccount id for a workspace's connected inbox, following the
 * EmailConnection -> EmailAccount chain (the provider account id is the
 * provider's stable subject id, falling back to the address for legacy rows).
 * Returns null when there is no connection or the account row does not exist yet.
 *
 * Centralizes a lookup that several billing/sync routes need so the chain is not
 * re-spelled (and kept in sync) in each one. Provider-neutral.
 */
export async function resolveEmailAccountId(workspaceId: string): Promise<string | null> {
  const connection = await db.emailConnection.findUnique({
    where: { workspaceId },
    select: { emailAddress: true, subjectId: true },
  });
  if (!connection) return null;

  const providerAccountId = connection.subjectId ?? connection.emailAddress;
  const account = await db.emailAccount.findUnique({
    where: { workspaceId_providerAccountId: { workspaceId, providerAccountId } },
    select: { id: true },
  });
  return account?.id ?? null;
}
