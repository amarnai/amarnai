import { redirect } from "next/navigation";
import Link from "next/link";
import { requireUser } from "@/lib/session";
import { stripe } from "@/lib/stripe";
import { db } from "@amarnai/db";
import { WorkspaceSetupWaiting } from "./WorkspaceSetupWaiting";

export const metadata = { title: "Upgrade Successful — Amarnai" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const planLabels: Record<string, string> = { PRO: "Pro", BUSINESS: "Business" };

export default async function UpgradeSuccessPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const user = await requireUser();
  const { session_id } = await searchParams;

  if (typeof session_id !== "string") redirect("/upgrade");

  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(session_id);
  } catch {
    redirect("/upgrade");
  }

  if (session.client_reference_id !== user.id) redirect("/upgrade");
  if (session.status === "expired") redirect("/upgrade");

  const meta = session.metadata ?? {};
  const subscriptionId =
    typeof session.subscription === "string" ? session.subscription : null;

  let workspace: {
    id: string;
    name: string;
    plan: string;
    currentPeriodEnd: Date | null;
    trialEndsAt: Date | null;
  } | null = null;

  if (meta.action === "upgrade" && meta.workspaceId) {
    workspace = await db.workspace.findUnique({
      where: { id: meta.workspaceId },
      select: {
        id: true,
        name: true,
        plan: true,
        currentPeriodEnd: true,
        trialEndsAt: true,
      },
    });
  } else if (meta.action === "create" && subscriptionId) {
    workspace = await db.workspace.findFirst({
      where: { stripeSubscriptionId: subscriptionId },
      select: {
        id: true,
        name: true,
        plan: true,
        currentPeriodEnd: true,
        trialEndsAt: true,
      },
    });
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
      <Link href="/emails" className="btn-primary upgrade-success-cta">
        Go to {workspace.name}
      </Link>
    </div>
  );
}
