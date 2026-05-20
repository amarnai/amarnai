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

export async function getOrCreateDefaultWorkspace(userId: string) {
  const existing = await db.workspace.findFirst({
    where: { ownerUserId: userId },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true },
  });
  if (existing) return existing;

  const created = await db.workspace.create({
    data: {
      name: "My Workspace",
      ownerUserId: userId,
      members: {
        create: { userId, role: "OWNER" },
      },
    },
    select: { id: true, name: true },
  });
  return created;
}

export async function assertWorkspaceOwner(workspaceId: string, userId: string) {
  const ws = await db.workspace.findFirst({
    where: { id: workspaceId, ownerUserId: userId },
    select: { id: true },
  });
  if (!ws) redirect("/dashboard");
}
