import { redirect } from "next/navigation";
import { requireUser, getUserWorkspaceRole } from "@/lib/session";
import { getSelectedWorkspace } from "@/lib/workspace";
import { apiFor } from "@/lib/api";
import { db } from "@amarnai/db";
import { hasWritebackScope as gmailHasWriteback } from "@amarnai/gmail";
import { hasWritebackScope as outlookHasWriteback } from "@amarnai/outlook";
import { assembleBillingState } from "@/lib/billing-state";
import { GmailConnectionSection } from "./GmailConnectionSection";
import { isOutlookConfigured } from "@/lib/outlook-oauth";
import { isLabelWritebackEnabled } from "@/lib/writeback-flag";
import { WorkspaceSettingsSections } from "./WorkspaceSettingsSections";
import { DeleteWorkspaceSection } from "./DeleteWorkspaceSection";
import { ResetWorkspaceSection } from "./ResetWorkspaceSection";
import { EmailBlacklistSection } from "./EmailBlacklistSection";
import { TeamMembersSection } from "./TeamMembersSection";
import { BillingSection } from "./BillingSection";
import { Trans } from "@lingui/react/macro";
import { initServerI18n } from "@/lib/i18n-server";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function SettingsPage({ searchParams }: { searchParams: SearchParams }) {
  await initServerI18n();
  const user = await requireUser();
  const workspace = await getSelectedWorkspace(user.id);
  const params = await searchParams;

  const role = await getUserWorkspaceRole(workspace.id, user.id);
  const isAdmin = role === "OWNER";

  // A failed connect redirects back with gmail_error or outlook_error; the
  // present one also tells us which provider's error copy to show.
  const gmailError =
    typeof params["gmail_error"] === "string" ? params["gmail_error"] : null;
  const outlookError =
    typeof params["outlook_error"] === "string" ? params["outlook_error"] : null;
  const connectError = gmailError ?? outlookError;
  const connectProvider = outlookError ? ("OUTLOOK" as const) : ("GMAIL" as const);
  const outlookEnabled = isOutlookConfigured();
  const billingCancelled = params["cancelled"] === "true";
  const labelWritebackFlagOn = isLabelWritebackEnabled();
  const writebackJustEnabled = params["writeback"] === "enabled";
  // The extension panel has no consent route of its own, so its writeback
  // toggle sends the user here with ?writeback=connect. Start the grant for
  // them: landing on this page and hunting for the same toggle a second time
  // reads as the click having done nothing.
  const writebackRequested = params["writeback"] === "connect";

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

  // Whether this workspace holds retained synced email that connecting a
  // DIFFERENT inbox would erase (rotation cleanup). Drives the switch warning.
  const hasSyncedData = (await db.emailThread.count({ where: { workspaceId: workspace.id } })) > 0;

  // Whether the connected mailbox already holds the write scope, so the writeback
  // toggle can flip directly instead of routing through incremental consent.
  let hasWriteScope = false;
  if (labelWritebackFlagOn) {
    const conn = await db.emailConnection.findUnique({
      where: { workspaceId: workspace.id },
      select: { provider: true, grantedScopes: true, status: true },
    });
    if (conn?.status === "ACTIVE") {
      hasWriteScope =
        conn.provider === "OUTLOOK"
          ? outlookHasWriteback(conn.grantedScopes)
          : gmailHasWriteback(conn.grantedScopes);
    }
  }

  // Only when the grant is actually missing: with the scope already held there
  // is nothing to consent to, and the page renders normally so the toggle can
  // be flipped directly. Owner-only, because the connect route refuses members.
  if (writebackRequested && labelWritebackFlagOn && isAdmin && !hasWriteScope && connection?.status === "ACTIVE") {
    const providerPath = connection.provider === "OUTLOOK" ? "outlook" : "gmail";
    redirect(`/api/${providerPath}/connect?workspaceId=${workspace.id}&intent=writeback`);
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
          <WorkspaceSettingsSections
            workspaceId={workspace.id}
            currentName={workspace.name}
            currentLocale={workspace.locale}
          />
          <GmailConnectionSection
            workspaceId={workspace.id}
            connection={connection}
            syncStatus={syncStatus}
            syncSettings={syncSettings}
            connectError={connectError}
            connectProvider={connectProvider}
            outlookEnabled={outlookEnabled}
            hasSyncedData={hasSyncedData}
            labelWritebackFlagOn={labelWritebackFlagOn}
            hasWriteScope={hasWriteScope}
            writebackJustEnabled={writebackJustEnabled}
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
