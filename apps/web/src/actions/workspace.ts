"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db, resetWorkspaceData, deleteWorkspaceCascade, createFreeWorkspace, FreeWorkspaceLimitError } from "@aziru/db";
import { isSupportedLocale, type SupportedLocale } from "@aziru/i18n";
import { requireUser } from "@/lib/session";
import { getSelectedWorkspace } from "@/lib/workspace";
import { getRequestLocale } from "@/lib/i18n-server";
import { disconnectGmailBeforeDeletion } from "@/lib/gmail-teardown";
import { apiFor } from "@/lib/api";

const WORKSPACE_COOKIE = "amarnai-workspace";
const LOCALE_COOKIE = "amarnai_locale";

// The active workspace's language drives both the UI and AI-generated taxonomy.
// proxy.ts resolves the UI locale from this cookie without a DB read, so we keep
// it in sync whenever the active workspace (or its language) changes.
async function setLocaleCookie(locale: string): Promise<void> {
  const jar = await cookies();
  jar.set(LOCALE_COOKIE, locale, { path: "/", maxAge: 60 * 60 * 24 * 365 });
}

export async function switchWorkspaceAction(
  workspaceId: string,
  redirectTo?: string,
): Promise<void> {
  const user = await requireUser();

  // Allow both owners and team members to switch to any workspace they belong to.
  const member = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: user.id } },
    select: { role: true, workspace: { select: { locale: true } } },
  });
  if (!member) return;

  const cookieStore = await cookies();
  cookieStore.set(WORKSPACE_COOKIE, workspaceId, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });
  // Follow the target workspace's language.
  await setLocaleCookie(member.workspace.locale);

  // Only honour same-origin internal paths to avoid an open redirect; anything
  // else (or nothing) falls back to the emails list. Used to deep-link into a
  // specific thread after switching (e.g. opening a cross-workspace notification).
  const target = redirectTo && redirectTo.startsWith("/") ? redirectTo : "/emails";
  redirect(target);
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

  // Only admins (OWNER) can rename the workspace.
  const member = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: user.id } },
    select: { role: true },
  });
  if (member?.role !== "OWNER") return { error: "Only admins can rename the workspace" };

  await db.workspace.update({ where: { id: workspace.id }, data: { name } });
  revalidatePath("/", "layout");
  return { success: true };
}

export async function createWorkspaceAction(
  name: string,
): Promise<{ error?: string; success?: boolean }> {
  const user = await requireUser();
  const trimmed = name.trim();
  if (!trimmed) return { error: "Workspace name cannot be empty" };
  if (trimmed.length > 100) return { error: "Name must be 100 characters or fewer" };

  // Seed the new workspace's language from the creator's current UI locale.
  const locale = await getRequestLocale();

  let workspaceId: string;
  try {
    workspaceId = await createFreeWorkspace(user.id, trimmed, locale);
  } catch (err) {
    if (err instanceof FreeWorkspaceLimitError) return { error: err.message };
    throw err;
  }

  const cookieStore = await cookies();
  cookieStore.set(WORKSPACE_COOKIE, workspaceId, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });
  await setLocaleCookie(locale);

  revalidatePath("/", "layout");
  return { success: true };
}

// Change the active workspace's language — OWNER only. Updates the workspace row
// and re-syncs the locale cookie so the UI switches immediately; the next
// taxonomy generation will use the new language too.
export async function setWorkspaceLocaleAction(
  locale: SupportedLocale,
): Promise<{ error?: string; success?: boolean }> {
  if (!isSupportedLocale(locale)) return { error: "Unsupported locale" };

  const user = await requireUser();
  const workspace = await getSelectedWorkspace(user.id);

  const member = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: user.id } },
    select: { role: true },
  });
  if (member?.role !== "OWNER") return { error: "Only admins can change the language" };

  await db.workspace.update({ where: { id: workspace.id }, data: { locale } });
  await setLocaleCookie(locale);
  revalidatePath("/", "layout");
  return { success: true };
}

export async function deleteWorkspaceAction(
  workspaceId: string,
): Promise<{ error?: string }> {
  const user = await requireUser();

  // Only the admin (OWNER) can delete a workspace.
  const workspace = await db.workspace.findFirst({
    where: { id: workspaceId, ownerUserId: user.id },
    select: { id: true },
  });
  if (!workspace) return { error: "Workspace not found or you are not the admin" };

  const count = await db.workspace.count({ where: { ownerUserId: user.id } });
  if (count <= 1) return { error: "You cannot delete your only workspace" };

  // Cancel queued sorting jobs and revoke the Gmail grant before the rows
  // disappear — after the cascade the disconnect service has nothing to work
  // with. Best-effort: never blocks deletion.
  await disconnectGmailBeforeDeletion(user.id, [workspaceId]);

  // FK-safe cascade shared with the API route (single source of truth).
  await deleteWorkspaceCascade(workspaceId);

  const cookieStore = await cookies();
  const selectedId = cookieStore.get(WORKSPACE_COOKIE)?.value;
  if (selectedId === workspaceId) {
    cookieStore.delete(WORKSPACE_COOKIE);
  }

  revalidatePath("/", "layout");
  redirect("/emails");
}

export async function resetWorkspaceAction(
  workspaceId: string,
): Promise<{ error?: string }> {
  const user = await requireUser();

  const workspace = await db.workspace.findFirst({
    where: { id: workspaceId, ownerUserId: user.id },
    select: { id: true },
  });
  if (!workspace) return { error: "Workspace not found or you are not the admin" };

  // Best-effort Gmail disconnect before wiping taxonomy.
  const hasConnection = await db.emailConnection.findUnique({
    where: { workspaceId },
    select: { id: true },
  });
  if (hasConnection) {
    try {
      await apiFor(user.id).disconnectGmail(workspaceId, true);
    } catch (err) {
      console.warn(
        "[reset-workspace] Gmail disconnect failed (non-fatal):",
        err instanceof Error ? err.message : err,
      );
    }
  }

  // Belt-and-suspenders cleanup shared with the API route: wipes data in FK-safe
  // order and restores Inbox. Covers the case where the disconnect above failed;
  // deleteMany on already-deleted rows is a no-op.
  await resetWorkspaceData(workspaceId);

  revalidatePath("/", "layout");
  redirect("/emails");
}
