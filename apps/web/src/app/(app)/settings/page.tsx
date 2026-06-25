import { requireUser, getUserWorkspaceRole } from "@/lib/session";
import { getSelectedWorkspace } from "@/lib/workspace";
import { apiFor } from "@/lib/api";
import { db } from "@amarnai/db";
import { assembleBillingState } from "@/lib/billing-state";
import { GmailConnectionSection } from "./GmailConnectionSection";
import { WorkspaceNameSection } from "./WorkspaceNameSection";
import { DeleteWorkspaceSection } from "./DeleteWorkspaceSection";
import { ResetWorkspaceSection } from "./ResetWorkspaceSection";
import { EmailBlacklistSection } from "./EmailBlacklistSection";
import { TeamMembersSection } from "./TeamMembersSection";
import { BillingSection } from "./BillingSection";
import { Trans } from "@lingui/react/macro";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function SettingsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const workspace = await getSelectedWorkspace(user.id);
  const params = await searchParams;

  const role = await getUserWorkspaceRole(workspace.id, user.id);
  const isAdmin = role === "OWNER";

  const connectError =
    typeof params["gmail_error"] === "string" ? params["gmail_error"] : null;
  const billingCancelled = params["cancelled"] === "true";

  let connection = null;
  let syncStatus = null;
  let syncSettings = null;
  const userApi = apiFor(user.id);
  try {
    [connection, syncStatus, syncSettings] = await Promise.all([
      userApi.gmailConnection(workspace.id),
      userApi.syncStatus(workspace.id),
      userApi.gmailSyncSettings(workspace.id),
    ]);
  } catch {
    // API unavailable — show disconnected state
  }

  // Billing state, reconciled with Stripe on portal return. Computed before the
  // team list below so any trial-cancellation member removal is reflected there.
  const billingState = await assembleBillingState(user.id, workspace.id, {
    forceReconcile: billingCancelled,
  });

  // Fetch team members and pending invitations for the team section.
  const ownedWorkspaceCount = await db.workspace.count({ where: { ownerUserId: user.id } });

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

  const [draftQuota, threadSortQuota] = isAdmin
    ? await Promise.all([
        userApi.draftQuota(workspace.id).catch(() => null),
        userApi.threadSortQuota(workspace.id).catch(() => null),
      ])
    : [null, null];

  const collaboratorLimit = billingState.collaboratorLimit;

  return (
    <>
      <h1><Trans>Workspace Settings</Trans></h1>

      {isAdmin && (
        <>
          <WorkspaceNameSection currentName={workspace.name} />
          <GmailConnectionSection
            workspaceId={workspace.id}
            connection={connection}
            syncStatus={syncStatus}
            syncSettings={syncSettings}
            connectError={connectError}
          />
          <EmailBlacklistSection
            workspaceId={workspace.id}
            initialEmails={syncSettings?.blacklistedSenderEmails ?? []}
          />
        </>
      )}

      <TeamMembersSection
        workspaceId={workspace.id}
        isAdmin={isAdmin}
        members={members}
        pendingInvitations={pendingInvitations}
        collaboratorLimit={collaboratorLimit}
      />

      {isAdmin && (
        <>
          <BillingSection
            plan={billingState.plan}
            billingCycle={billingState.billingCycle}
            currentPeriodEnd={billingState.currentPeriodEnd ? new Date(billingState.currentPeriodEnd) : null}
            trialEndsAt={billingState.trialEndsAt ? new Date(billingState.trialEndsAt) : null}
            cancelAtPeriodEnd={billingState.cancelAtPeriodEnd}
            paymentFailed={billingState.paymentFailed}
            hasSubscription={billingState.hasSubscription}
            isAdmin={isAdmin}
            cancelled={billingCancelled}
            membersToRemoveOnCancel={billingState.membersToRemoveOnCancel}
            draftQuota={draftQuota}
            threadSortQuota={threadSortQuota}
            collaboratorCount={billingState.collaboratorCount}
            collaboratorLimit={collaboratorLimit}
          />
          {ownedWorkspaceCount <= 1 ? (
            <ResetWorkspaceSection workspaceId={workspace.id} />
          ) : (
            <DeleteWorkspaceSection workspaceId={workspace.id} />
          )}
        </>
      )}
    </>
  );
}
