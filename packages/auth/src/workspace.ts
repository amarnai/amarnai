import { db, ensureInboxTaxonomy } from "@amarnai/db";

// Returns the user's primary workspace, creating their first one (with the
// mandatory Inbox + catch-all taxonomy and an OWNER membership) if they have
// none. Shared by the web
// app and the API sign-in flow so onboarding provisioning lives in one place.
export async function getOrCreateDefaultWorkspace(userId: string, locale = "en") {
  // Prefer a workspace owned by this user.
  const owned = await db.workspace.findFirst({
    where: { ownerUserId: userId },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, locale: true, plan: true },
  });
  if (owned) return owned;

  // Fall back to a workspace where the user is a team member.
  const membership = await db.workspaceMember.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { workspace: { select: { id: true, name: true, locale: true, plan: true } } },
  });
  if (membership) return membership.workspace;

  // New user — create their first workspace.
  const created = await db.workspace.create({
    data: {
      name: "My Workspace",
      ownerUserId: userId,
      locale,
      members: {
        create: { userId, role: "OWNER" },
      },
    },
    select: { id: true, name: true, locale: true, plan: true },
  });
  await ensureInboxTaxonomy(created.id);
  return created;
}
