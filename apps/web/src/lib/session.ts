import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@amarnai/db";

export type AuthUser = {
  id: string;
  email: string;
  name: string | null | undefined;
  image: string | null | undefined;
};

export type WorkspaceRole = "OWNER" | "ADMIN" | "MEMBER";

/**
 * Resolve the signed-in user, but only if their session id still maps to a real
 * User row; otherwise null.
 *
 * The JWT caches userId and does not re-validate it once set, so a session can
 * outlive its User row (a deleted user, or a reset dev DB). Every "am I signed
 * in?" decision must agree on this, or guards fight each other: without the DB
 * check, requireUser would bounce a stale session to /sign-in while the sign-in
 * page would bounce it straight back to /emails, looping forever. Cached so the
 * lookup runs at most once per request.
 */
export const getSessionUser = cache(async function getSessionUser(): Promise<AuthUser | null> {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) return null;

  const dbUser = await db.user.findUnique({
    where: { id: session.user.id },
    select: { id: true },
  });
  if (!dbUser) return null;

  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    image: session.user.image,
  };
});

export async function requireUser(): Promise<AuthUser> {
  const user = await getSessionUser();
  if (!user) redirect("/sign-in");
  return user;
}


/** Returns the user's role in the workspace, or null if not a member. */
export async function getUserWorkspaceRole(
  workspaceId: string,
  userId: string
): Promise<WorkspaceRole | null> {
  const member = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: { role: true },
  });
  return (member?.role as WorkspaceRole) ?? null;
}

/** Redirects to /emails if the user is not the workspace admin (OWNER). */
export async function assertWorkspaceAdmin(workspaceId: string, userId: string): Promise<void> {
  const role = await getUserWorkspaceRole(workspaceId, userId);
  if (role !== "OWNER") redirect("/emails");
}

/** Redirects to /emails if the user is not a member (any role) of the workspace. */
export async function assertWorkspaceMember(workspaceId: string, userId: string): Promise<void> {
  const role = await getUserWorkspaceRole(workspaceId, userId);
  if (!role) redirect("/emails");
}

/**
 * Whether the user may edit this workspace's taxonomy. Mirrors the API's
 * isTaxonomyEditor, which is the authority: OWNERs always may, MEMBERs may when
 * the workspace has membersCanEditTaxonomy enabled. Used to decide whether the
 * editor renders read-only, not to authorize the writes themselves (the API
 * enforces those on every mutating route).
 */
export async function canEditTaxonomy(workspaceId: string, userId: string): Promise<boolean> {
  const [member, workspace] = await Promise.all([
    db.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { role: true },
    }),
    db.workspace.findUnique({
      where: { id: workspaceId },
      select: { membersCanEditTaxonomy: true },
    }),
  ]);
  if (!member) return false;
  if (member.role === "OWNER") return true;
  return workspace?.membersCanEditTaxonomy ?? false;
}

/** @deprecated Use assertWorkspaceAdmin */
export async function assertWorkspaceOwner(workspaceId: string, userId: string): Promise<void> {
  return assertWorkspaceAdmin(workspaceId, userId);
}
