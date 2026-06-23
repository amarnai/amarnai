import { db } from "@amarnai/db";

/**
 * Resolve the EmailAccount id for a workspace's connected Gmail inbox, following
 * the GmailConnection -> EmailAccount chain (the provider account id is the
 * Google subject id, falling back to the address for legacy rows). Returns null
 * when there is no connection or the account row does not exist yet.
 *
 * Centralizes a lookup that several billing/sync routes need so the chain is not
 * re-spelled (and kept in sync) in each one.
 */
export async function resolveEmailAccountId(workspaceId: string): Promise<string | null> {
  const connection = await db.gmailConnection.findUnique({
    where: { workspaceId },
    select: { gmailAddress: true, googleSubjectId: true },
  });
  if (!connection) return null;

  const providerAccountId = connection.googleSubjectId ?? connection.gmailAddress;
  const account = await db.emailAccount.findUnique({
    where: { workspaceId_providerAccountId: { workspaceId, providerAccountId } },
    select: { id: true },
  });
  return account?.id ?? null;
}
