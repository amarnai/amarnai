import { requireUser, getUserWorkspaceRole } from "@/lib/session";
import { getSelectedWorkspace } from "@/lib/workspace";
import { api } from "@/lib/api";
import { db } from "@amarnai/db";
import { GmailConnectionSection } from "./GmailConnectionSection";
import { WorkspaceNameSection } from "./WorkspaceNameSection";
import { DeleteWorkspaceSection } from "./DeleteWorkspaceSection";
import { EmailBlacklistSection } from "./EmailBlacklistSection";
import { TeamMembersSection } from "./TeamMembersSection";
import { BillingSection } from "./BillingSection";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

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

  const billing = await db.workspace.findUnique({
    where: { id: workspace.id },
    select: {
      plan: true,
      billingCycle: true,
      currentPeriodEnd: true,
      trialEndsAt: true,
      cancelAtPeriodEnd: true,
      paymentFailed: true,
      stripeSubscriptionId: true,
    },
  });

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
          <BillingSection
            plan={billing?.plan ?? workspace.plan}
            billingCycle={billing?.billingCycle ?? null}
            currentPeriodEnd={billing?.currentPeriodEnd ?? null}
            trialEndsAt={billing?.trialEndsAt ?? null}
            cancelAtPeriodEnd={billing?.cancelAtPeriodEnd ?? false}
            paymentFailed={billing?.paymentFailed ?? false}
            hasSubscription={!!billing?.stripeSubscriptionId}
            isAdmin={isAdmin}
          />

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
