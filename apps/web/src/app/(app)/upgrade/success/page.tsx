import { redirect } from "next/navigation";
import Image from "next/image";
import { requireUser } from "@/lib/session";
import { getStripe } from "@/lib/stripe";
import { db } from "@amarnai/db";
import { provisionFromCheckoutSession } from "@/lib/billing-provision";
import { switchWorkspaceAction } from "@/actions/workspace";
import { WorkspaceSetupWaiting } from "./WorkspaceSetupWaiting";
import { Trans } from "@lingui/react/macro";
import { initServerI18n } from "@/lib/i18n-server";

export const metadata = { title: "Upgrade Successful | Amarnai" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const planLabels: Record<string, string> = { PRO: "Scribe", BUSINESS: "Pharaoh" };

export default async function UpgradeSuccessPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await initServerI18n();
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

  // Provision through the single source of truth (same path as the webhook and
  // mobile confirm-checkout): sets the plan, enforces trial eligibility, resets the
  // backfill, and writes the audit log. Idempotent, so racing the webhook is safe.
  const result = await provisionFromCheckoutSession(session);
  if (!result) {
    return <WorkspaceSetupWaiting />;
  }

  const workspace = await db.workspace.findUnique({
    where: { id: result.workspaceId },
    select: {
      id: true,
      name: true,
      plan: true,
      currentPeriodEnd: true,
      trialEndsAt: true,
    },
  });
  if (!workspace) {
    return <WorkspaceSetupWaiting />;
  }

  const planLabel = planLabels[workspace.plan] ?? workspace.plan;
  const isTrialing = workspace.trialEndsAt && workspace.trialEndsAt > new Date();

  return (
    <div className="upgrade-success-page">
      <div className="upgrade-success-stage">
        <div className="upgrade-success-mascot">
          <Image
            src="/aziru-upgrade.png"
            alt="King Aziru"
            width={1254}
            height={1254}
            style={{ width: "100%", height: "auto" }}
            priority
          />
        </div>
        <div className="upgrade-success-card">
          <div className="upgrade-success-badge" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 32 32" fill="none">
              <circle cx="16" cy="16" r="16" fill="var(--accent)" />
              <path
                d="M9 16.5 13.5 21 23 11"
                stroke="#fff"
                strokeWidth="2.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <Trans>Payment confirmed</Trans>
          </div>
          <h1 className="upgrade-success-title">
            <Trans>You&apos;re on {planLabel}</Trans>
          </h1>
          <p className="upgrade-success-workspace">{workspace.name}</p>
          {isTrialing && workspace.trialEndsAt && (
            <p className="upgrade-success-body">
              <Trans>
                Your 14-day free trial runs until{" "}
                <strong>{workspace.trialEndsAt.toLocaleDateString()}</strong>. You
                won&apos;t be charged before then.
              </Trans>
            </p>
          )}
          {!isTrialing && workspace.currentPeriodEnd && (
            <p className="upgrade-success-body">
              <Trans>
                Renews on{" "}
                <strong>{workspace.currentPeriodEnd.toLocaleDateString()}</strong>.
              </Trans>
            </p>
          )}
          {/* Switch the active-workspace cookie to the purchased workspace before
              navigating — a plain link to /emails would keep the previous selection. */}
          <form action={switchWorkspaceAction.bind(null, workspace.id, "/emails")}>
            <button type="submit" className="btn-primary upgrade-success-cta">
              <Trans>Go to {workspace.name}</Trans>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
