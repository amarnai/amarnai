"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@amarnai/db";
import { requireUser } from "@/lib/session";
import { getSelectedWorkspace } from "@/lib/workspace";

const WORKSPACE_COOKIE = "amarnai-workspace";

export async function switchWorkspaceAction(workspaceId: string): Promise<void> {
  const user = await requireUser();

  const ws = await db.workspace.findFirst({
    where: { id: workspaceId, ownerUserId: user.id },
    select: { id: true },
  });
  if (!ws) return;

  const cookieStore = await cookies();
  cookieStore.set(WORKSPACE_COOKIE, workspaceId, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });

  redirect("/folders");
}

export async function updateWorkspaceNameAction(
  _prev: { error?: string; success?: boolean } | null,
  formData: FormData,
): Promise<{ error?: string; success?: boolean }> {
  const user = await requireUser();
  const name = (formData.get("name") as string | null)?.trim() ?? "";
  if (!name) return { error: "Workspace name cannot be empty" };
  if (name.length > 100) return { error: "Name must be 100 characters or fewer" };
  const workspace = await getSelectedWorkspace(user.id);
  await db.workspace.update({ where: { id: workspace.id }, data: { name } });
  revalidatePath("/", "layout");
  return { success: true };
}
