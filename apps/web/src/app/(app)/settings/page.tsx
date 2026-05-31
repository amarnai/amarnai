import Link from "next/link";
import { requireUser, getUserWorkspaceRole } from "@/lib/session";
import { getSelectedWorkspace } from "@/lib/workspace";
import { api } from "@/lib/api";
import { db, WorkspacePlan } from "@amarnai/db";
import { GmailConnectionSection } from "./GmailConnectionSection";
import { WorkspaceNameSection } from "./WorkspaceNameSection";
import { DeleteWorkspaceSection } from "./DeleteWorkspaceSection";
import { EmailBlacklistSection } from "./EmailBlacklistSection";
import { TeamMembersSection } from "./TeamMembersSection";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const planLabels: Record<string, string> = {
  FREE: "Personal",
  PRO: "Pro",
  BUSINESS: "Business",
};

export default async function SettingsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const workspace = await getSelectedWorkspace(user.id);
  const params = await searchParams;

  const role = await getUserWorkspaceRole(workspace.id, user.id);
  const isAdmin = role === "OWNER";

  const connectError =
    typeof params["gmail_error"] === "string" ? params["gmail_error"] : null;
  const connectSuccess = params["gmail_connected"] === "1";

  let connection = null;
  let syncStatus = null;
  let syncSettings = null;
  try {
    [connection, syncStatus, syncSettings] = await Promise.all([
      api.gmailConnection(workspace.id),
      api.syncStatus(workspace.id),
      api.gmailSyncSettings(workspace.id),
    ]);
  } catch {
    // API unavailable — show disconnected state
  }

  // Fetch team members and pending invitations for the team section.
  const [membersRaw, invitationsRaw] = await Promise.all([
    db.workspaceMember.findMany({
      where: { workspaceId: workspace.id },
      select: {
        id: true,
        userId: true,
        role: true,
        user: { select: { email: true, name: true } },
      },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    }),
    isAdmin
      ? db.workspaceInvitation.findMany({
          where: { workspaceId: workspace.id },
          select: { id: true, invitedEmail: true, expiresAt: true },
          orderBy: { createdAt: "desc" },
        })
      : Promise.resolve([]),
  ]);

  // Sort: OWNER first, then MEMBER.
  const members = membersRaw
    .sort((a, b) => {
      if (a.role === "OWNER" && b.role !== "OWNER") return -1;
      if (a.role !== "OWNER" && b.role === "OWNER") return 1;
      return 0;
    })
    .map((m) => ({
      id: m.id,
      userId: m.userId,
      role: m.role,
      user: m.user,
    }));

  const pendingInvitations = invitationsRaw.map((inv) => ({
    id: inv.id,
    invitedEmail: inv.invitedEmail,
    expiresAt: inv.expiresAt.toISOString(),
  }));

  return (
    <>
      <h1>Workspace Settings</h1>

      <TeamMembersSection
        workspaceId={workspace.id}
        isAdmin={isAdmin}
        members={members}
        pendingInvitations={pendingInvitations}
      />

      {isAdmin && (
        <>
          <section className="settings-section">
            <h2>Plan</h2>
            <div className="plan-current-row">
              <span className="plan-current-badge">{planLabels[workspace.plan] ?? workspace.plan}</span>
              {workspace.plan !== WorkspacePlan.BUSINESS && (
                <Link href="/upgrade" className="btn-primary">
                  Upgrade
                </Link>
              )}
            </div>
          </section>

          <WorkspaceNameSection currentName={workspace.name} />
          <GmailConnectionSection
            workspaceId={workspace.id}
            connection={connection}
            syncStatus={syncStatus}
            syncSettings={syncSettings}
            connectError={connectError}
            connectSuccess={connectSuccess}
          />
          <EmailBlacklistSection
            workspaceId={workspace.id}
            initialEmails={syncSettings?.blacklistedSenderEmails ?? []}
          />
          <DeleteWorkspaceSection workspaceId={workspace.id} />
        </>
      )}
    </>
  );
}
