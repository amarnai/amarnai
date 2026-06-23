import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { getStripe } from "@/lib/stripe";
import { db, ensureInboxNode } from "@amarnai/db";
import { switchWorkspaceAction } from "@/actions/workspace";
import { WorkspaceSetupWaiting } from "./WorkspaceSetupWaiting";

export const metadata = { title: "Upgrade Successful — Amarnai" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const planLabels: Record<string, string> = { PRO: "Pro", BUSINESS: "Business" };

type WorkspaceResult = {
  id: string;
  name: string;
  plan: string;
  currentPeriodEnd: Date | null;
  trialEndsAt: Date | null;
};

export default async function UpgradeSuccessPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const user = await requireUser();
  const { session_id } = await searchParams;

  if (typeof session_id !== "string") redirect("/upgrade");

  const stripe = getStripe();
  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(session_id);
  } catch {
    redirect("/upgrade");
  }

  if (session.client_reference_id !== user.id) redirect("/upgrade");
  if (session.status === "expired") redirect("/upgrade");

  // Session not yet complete — poll until Stripe confirms payment.
  if (session.status !== "complete") {
    return <WorkspaceSetupWaiting />;
  }

  const meta = session.metadata ?? {};
  const subscriptionId =
    typeof session.subscription === "string" ? session.subscription : null;
  const customerId =
    typeof session.customer === "string" ? session.customer : null;
  const planValue = meta.plan === "pro" ? "PRO" : "BUSINESS";
  const cycleValue = meta.cycle === "annual" ? "ANNUAL" : "MONTHLY";

  // Fetch subscription details once for both upgrade and create paths.
  let currentPeriodEnd: Date | null = null;
  let trialEndsAt: Date | null = null;
  let priceId: string | null = null;

  if (subscriptionId) {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const item = subscription.items.data[0];
    if (item?.current_period_end) {
      currentPeriodEnd = new Date(item.current_period_end * 1000);
    }
    if (subscription.trial_end) {
      trialEndsAt = new Date(subscription.trial_end * 1000);
    }
    priceId = item?.price.id ?? null;
  }

  let workspace: WorkspaceResult | null = null;

  if (meta.action === "upgrade" && meta.workspaceId) {
    // Update directly — idempotent with the webhook.
    workspace = await db.workspace.update({
      where: { id: meta.workspaceId },
      data: {
        plan: planValue,
        ...(customerId && { stripeCustomerId: customerId }),
        ...(subscriptionId && { stripeSubscriptionId: subscriptionId }),
        stripePriceId: priceId,
        billingCycle: cycleValue,
        trialEndsAt,
        currentPeriodEnd,
        cancelAtPeriodEnd: false,
        paymentFailed: false,
      },
      select: {
        id: true,
        name: true,
        plan: true,
        currentPeriodEnd: true,
        trialEndsAt: true,
      },
    });
  } else if (meta.action === "create" && subscriptionId) {
    const existing = await db.workspace.findFirst({
      where: { stripeSubscriptionId: subscriptionId },
      select: {
        id: true,
        name: true,
        plan: true,
        currentPeriodEnd: true,
        trialEndsAt: true,
      },
    });

    if (existing) {
      workspace = existing;
    } else {
      const created = await db.workspace.create({
        data: {
          name: meta.newWorkspaceName || "My Workspace",
          ownerUserId: user.id,
          plan: planValue,
          ...(customerId && { stripeCustomerId: customerId }),
          stripeSubscriptionId: subscriptionId,
          stripePriceId: priceId,
          billingCycle: cycleValue,
          trialEndsAt,
          currentPeriodEnd,
          members: { create: { userId: user.id, role: "OWNER" } },
        },
        select: {
          id: true,
          name: true,
          plan: true,
          currentPeriodEnd: true,
          trialEndsAt: true,
        },
      });
      await ensureInboxNode(created.id);
      workspace = created;
    }
  }

  if (!workspace) {
    return <WorkspaceSetupWaiting />;
  }

  const planLabel = planLabels[workspace.plan] ?? workspace.plan;
  const isTrialing = workspace.trialEndsAt && workspace.trialEndsAt > new Date();

  return (
    <div className="upgrade-success-page">
      <div className="upgrade-success-check" aria-hidden="true">
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
          <circle cx="16" cy="16" r="16" fill="var(--accent)" />
          <path
            d="M9 16.5 13.5 21 23 11"
            stroke="#fff"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <h1 className="upgrade-success-title">You&apos;re on {planLabel}</h1>
      <p className="upgrade-success-workspace">{workspace.name}</p>
      {isTrialing && workspace.trialEndsAt && (
        <p className="upgrade-success-body">
          Your 14-day free trial runs until{" "}
          <strong>{workspace.trialEndsAt.toLocaleDateString()}</strong>. You
          won&apos;t be charged before then.
        </p>
      )}
      {!isTrialing && workspace.currentPeriodEnd && (
        <p className="upgrade-success-body">
          Renews on{" "}
          <strong>{workspace.currentPeriodEnd.toLocaleDateString()}</strong>.
        </p>
      )}
      {/* Switch the active-workspace cookie to the purchased workspace before
          navigating — a plain link to /emails would keep the previous selection. */}
      <form action={switchWorkspaceAction.bind(null, workspace.id)}>
        <button type="submit" className="btn-primary upgrade-success-cta">
          Go to {workspace.name}
        </button>
      </form>
    </div>
  );
}
