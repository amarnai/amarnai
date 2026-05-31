import "server-only";
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

export async function requireUser(): Promise<AuthUser> {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    redirect("/sign-in");
  }
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    image: session.user.image,
  };
}

export { getOrCreateDefaultWorkspace } from "@/lib/workspace";

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
 * Verifies the user can edit taxonomy in this workspace.
 * Only OWNER role is permitted; all other roles are rejected.
 * Throws an error (not a redirect) so taxonomy actions can surface a useful message.
 */
export async function assertTaxonomyEditor(workspaceId: string, userId: string): Promise<void> {
  const member = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: { role: true },
  });

  if (!member) {
    throw new Error("Not a member of this workspace");
  }
  if (member.role !== "OWNER") {
    throw new Error("Taxonomy editing is restricted to workspace admins");
  }
}

/** @deprecated Use assertWorkspaceAdmin */
export async function assertWorkspaceOwner(workspaceId: string, userId: string): Promise<void> {
  return assertWorkspaceAdmin(workspaceId, userId);
}
