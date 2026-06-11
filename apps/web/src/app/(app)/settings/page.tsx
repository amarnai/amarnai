import { requireUser, getUserWorkspaceRole } from "@/lib/session";
import { getSelectedWorkspace } from "@/lib/workspace";
import { apiFor } from "@/lib/api";
import { db } from "@amarnai/db";
import { getStripe } from "@/lib/stripe";
import { getCollaboratorLimit } from "@amarnai/shared";
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

  const billingSelect = {
    plan: true,
    billingCycle: true,
    currentPeriodEnd: true,
    trialEndsAt: true,
    cancelAtPeriodEnd: true,
    paymentFailed: true,
    stripeSubscriptionId: true,
  } as const;

  let billing = await db.workspace.findUnique({
    where: { id: workspace.id },
    select: billingSelect,
  });

  // Sync subscription state from Stripe so the UI is accurate even if the webhook
  // hasn't arrived yet. Runs on every portal return (?cancelled=true) AND whenever
  // the workspace is on a paid plan but cancelAtPeriodEnd is not yet set — covering
  // the case where the user navigated away from the portal return URL.
  const needsSync =
    billing?.stripeSubscriptionId &&
    (billingCancelled ||
      (billing.plan !== "FREE" && !billing.cancelAtPeriodEnd));

  if (needsSync && billing?.stripeSubscriptionId) {
    try {
      const subscription = await getStripe().subscriptions.retrieve(billing.stripeSubscriptionId);

      if (subscription.status === "canceled") {
        // Subscription was deleted on Stripe — mirrors handleSubscriptionDeleted.
        await db.$transaction([
          db.workspaceMember.deleteMany({
            where: { workspaceId: workspace.id, NOT: { role: "OWNER" } },
          }),
          db.workspace.update({
            where: { id: workspace.id },
            data: {
              plan: "FREE",
              stripeSubscriptionId: null,
              stripePriceId: null,
              billingCycle: null,
              trialEndsAt: null,
              currentPeriodEnd: null,
              cancelAtPeriodEnd: false,
              paymentFailed: false,
            },
          }),
        ]);
      } else if (subscription.cancel_at_period_end && subscription.status === "trialing") {
        // Trial cancelled — revoke access immediately (mirrors webhook 1b logic).
        await db.$transaction([
          db.workspaceMember.deleteMany({
            where: { workspaceId: workspace.id, NOT: { role: "OWNER" } },
          }),
          db.workspace.update({
            where: { id: workspace.id },
            data: {
              plan: "FREE",
              stripeSubscriptionId: null,
              stripePriceId: null,
              billingCycle: null,
              trialEndsAt: null,
              currentPeriodEnd: null,
              cancelAtPeriodEnd: false,
              paymentFailed: false,
            },
          }),
        ]);
      } else if (subscription.cancel_at_period_end) {
        const item = subscription.items.data[0];
        const currentPeriodEnd = item?.current_period_end
          ? new Date(item.current_period_end * 1000)
          : null;
        await db.workspace.update({
          where: { id: workspace.id },
          data: { cancelAtPeriodEnd: true, currentPeriodEnd },
        });
      }

      billing = await db.workspace.findUnique({
        where: { id: workspace.id },
        select: billingSelect,
      });
    } catch {
      // Non-fatal — fall back to whatever state is already in the DB.
    }
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

  const membersToRemoveOnCancel = members
    .filter((m) => m.role !== "OWNER")
    .map((m) => ({ name: m.user.name, email: m.user.email }));

  const [draftQuota, threadSortQuota] = isAdmin
    ? await Promise.all([
        userApi.draftQuota(workspace.id).catch(() => null),
        userApi.threadSortQuota(workspace.id).catch(() => null),
      ])
    : [null, null];

  const collaboratorCount = members.filter((m) => m.role !== "OWNER").length;
  const collaboratorLimit = getCollaboratorLimit(billing?.plan ?? workspace.plan);

  return (
    <>
      <h1>Workspace Settings</h1>

      {isAdmin && (
        <>
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
            plan={billing?.plan ?? workspace.plan}
            billingCycle={billing?.billingCycle ?? null}
            currentPeriodEnd={billing?.currentPeriodEnd ?? null}
            trialEndsAt={billing?.trialEndsAt ?? null}
            cancelAtPeriodEnd={billing?.cancelAtPeriodEnd ?? false}
            paymentFailed={billing?.paymentFailed ?? false}
            hasSubscription={!!billing?.stripeSubscriptionId}
            isAdmin={isAdmin}
            cancelled={billingCancelled}
            membersToRemoveOnCancel={membersToRemoveOnCancel}
            draftQuota={draftQuota}
            threadSortQuota={threadSortQuota}
            collaboratorCount={collaboratorCount}
            collaboratorLimit={collaboratorLimit}
          />
          <DeleteWorkspaceSection workspaceId={workspace.id} />
        </>
      )}
    </>
  );
}
