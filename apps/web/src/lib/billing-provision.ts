import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { queueSubscriptionCancellation, subscriptionPeriodEnd } from "@amarnai/billing";
import { db, ensureInboxTaxonomy, claimTrial, Prisma } from "@amarnai/db";
import { BACKFILL_RESCAN_RESET } from "@/lib/backfill-reset";

export interface ProvisionResult {
  workspaceId: string;
  plan: "PRO" | "BUSINESS";
}

// none      — the subscription carries no (future) trial; nothing to enforce.
// granted   — the trial was claimed for this identity; it runs to trial_end.
// denied_*  — the identity/card already consumed a trial; the trial was stripped
//             (trial_end -> now) so the subscription bills immediately.
type TrialOutcome = "none" | "granted" | "denied_email" | "denied_card";

interface TrialPolicy {
  subscription: Stripe.Subscription;
  trialEndsAt: Date | null;
  trialOutcome: TrialOutcome;
  reason?: "email_claimed" | "card_claimed";
  // Set when the subscription must NOT provision paid access: an ineligible
  // (denied) trial whose immediate charge did not settle, or an already-dead
  // subscription. The subscription is canceled and the caller provisions nothing.
  abort?: boolean;
}

/**
 * Best-effort card fingerprint for per-card trial dedup.
 *
 * For a trial subscription collected via Checkout, the card is usually NOT on
 * `subscription.default_payment_method` at completion time — Checkout attaches it
 * to the customer as `invoice_settings.default_payment_method`. We check the
 * subscription first (authoritative when set), then fall back to the customer's
 * default. Both are expanded in the caller's single retrieve, so no extra API call.
 *
 * Returns null for non-card methods (Link, bank, wallets without a card
 * fingerprint) — per-card dedup simply doesn't apply there; email-identity dedup
 * still holds.
 */
function resolveCardFingerprint(subscription: Stripe.Subscription): string | null {
  const subPm = subscription.default_payment_method;
  if (subPm && typeof subPm === "object" && subPm.card?.fingerprint) {
    return subPm.card.fingerprint;
  }

  const customer = subscription.customer;
  if (customer && typeof customer === "object" && !("deleted" in customer)) {
    const custPm = customer.invoice_settings?.default_payment_method;
    if (custPm && typeof custPm === "object" && custPm.card?.fingerprint) {
      return custPm.card.fingerprint;
    }
  }
  return null;
}

/**
 * Decide (and enforce) whether this subscription's free trial is allowed, at
 * redemption time — the security boundary. The checkout route only *advertises*
 * eligibility; here we atomically claim the one trial per email identity and per
 * payment card. If the claim is denied, we end the trial immediately so the
 * subscription bills now rather than granting a second free trial.
 *
 * Idempotent: re-provisioning the same subscription (webhook + success-page race,
 * or a Stripe redelivery) re-claims its own trial and is granted again. A failure
 * to strip a denied trial throws (the caller's webhook 500s and Stripe redelivers,
 * or the success page reload retries) rather than silently granting it — except
 * when the trial has already been stripped, which is the outcome we wanted.
 *
 * A denied trial only provisions paid access if the immediate charge SETTLES. An
 * ineligible user whose card fails to pay is not left in Stripe's dunning window
 * (which would grant weeks of free access): the subscription is canceled and the
 * policy returns `abort` so the caller provisions nothing.
 */
async function enforceTrialPolicy(params: {
  subscriptionId: string;
  userId: string;
  userEmail: string;
}): Promise<TrialPolicy> {
  const stripe = getStripe();
  const subscription = await stripe.subscriptions.retrieve(params.subscriptionId, {
    // Expand both card sources so resolveCardFingerprint needs no extra API call.
    expand: ["default_payment_method", "customer.invoice_settings.default_payment_method"],
  });

  // A subscription that is already dead (e.g. we canceled it on a prior denied +
  // unpaid attempt, or Stripe canceled it) must never provision paid access.
  if (subscription.status === "canceled" || subscription.status === "incomplete_expired") {
    return { subscription, trialEndsAt: null, trialOutcome: "none", abort: true };
  }

  const trialEnd = subscription.trial_end;
  if (!trialEnd || trialEnd * 1000 <= Date.now()) {
    return {
      subscription,
      trialEndsAt: trialEnd ? new Date(trialEnd * 1000) : null,
      trialOutcome: "none",
    };
  }

  const cardFingerprint = resolveCardFingerprint(subscription);

  const claim = await claimTrial({
    email: params.userEmail,
    userId: params.userId,
    stripeSubscriptionId: subscription.id,
    cardFingerprint,
  });
  if (claim.granted) {
    return { subscription, trialEndsAt: new Date(trialEnd * 1000), trialOutcome: "granted" };
  }

  // Not eligible — end the trial now so Stripe charges the saved payment method.
  console.warn(
    `[billing/provision] trial denied for subscription ${subscription.id} (${claim.reason})`,
  );
  const outcome: TrialOutcome = claim.reason === "email_claimed" ? "denied_email" : "denied_card";
  let stripped: Stripe.Subscription;
  try {
    stripped = await stripe.subscriptions.update(subscription.id, {
      trial_end: "now",
      proration_behavior: "none",
    });
  } catch (err) {
    // A concurrent provision (or redelivery) may have already stripped the trial.
    // If the subscription is no longer trialing, continue with its current state;
    // otherwise the strip genuinely failed: rethrow (webhook 500s / page retries).
    const fresh = await stripe.subscriptions.retrieve(subscription.id);
    if (fresh.trial_end && fresh.trial_end * 1000 > Date.now()) throw err;
    stripped = fresh;
  }

  // Grant paid access only if ending the trial actually collected payment. An
  // `active` subscription is paid and current; any other status (past_due,
  // incomplete, unpaid) means the ineligible user did not pay — cancel the
  // subscription so it cannot linger in dunning granting weeks of free access.
  if (stripped.status === "active") {
    return { subscription: stripped, trialEndsAt: null, trialOutcome: outcome, reason: claim.reason };
  }

  console.warn(
    `[billing/provision] denied trial ${subscription.id} did not settle (status ${stripped.status}); canceling`,
  );
  const canceled = await stripe.subscriptions.cancel(subscription.id);
  return {
    subscription: canceled,
    trialEndsAt: null,
    trialOutcome: outcome,
    reason: claim.reason,
    abort: true,
  };
}

async function writeTrialDeniedAudit(
  workspaceId: string,
  userId: string,
  subscriptionId: string,
  reason: string,
): Promise<void> {
  await db.auditLog.create({
    data: {
      workspaceId,
      actorType: "SYSTEM",
      actorUserId: userId,
      eventType: "billing.trial.denied",
      entityType: "Workspace",
      entityId: workspaceId,
      metadata: { subscriptionId, reason },
    },
  });
}

/**
 * Provision a workspace from a completed Stripe Checkout session.
 *
 * Single source of truth, shared by the Stripe webhook, the web /upgrade/success
 * page, and the mobile confirm-checkout endpoint. Idempotent: an already-provisioned
 * upgrade/create short-circuits, so running from several callers at once is safe.
 * Trial eligibility is enforced here (see enforceTrialPolicy).
 *
 * Returns null when the session metadata is incomplete or the initiating user no
 * longer exists (orphaned payment — logged and the subscription queued for
 * cancellation so it cannot keep billing a vanished account).
 */
export async function provisionFromCheckoutSession(
  session: Stripe.Checkout.Session,
): Promise<ProvisionResult | null> {
  const meta = session.metadata;
  if (!meta?.action || !meta.userId) return null;

  const subscriptionId = session.subscription as string;
  const customerId = session.customer as string;

  const initiatingUser = await db.user.findUnique({
    where: { id: meta.userId },
    select: { id: true, email: true },
  });
  if (!initiatingUser) {
    console.error(
      `[billing/provision] orphaned checkout: user ${meta.userId} not found for ` +
        `subscription ${subscriptionId} (customer ${customerId}); queuing cancellation`,
    );
    // The paying account is gone — make sure the subscription is canceled so it
    // never keeps billing. The worker reconciles this row against Stripe.
    if (subscriptionId) {
      await queueSubscriptionCancellation(subscriptionId, meta.userId);
    }
    return null;
  }

  const planValue = meta.plan === "pro" ? "PRO" : "BUSINESS";
  const cycleValue = meta.cycle === "annual" ? "ANNUAL" : "MONTHLY";

  if (meta.action === "upgrade") {
    if (!meta.workspaceId) return null;

    // Idempotency: skip if this subscription already provisioned this workspace.
    const existing = await db.workspace.findUnique({
      where: { id: meta.workspaceId },
      select: { stripeSubscriptionId: true, plan: true },
    });
    if (existing?.stripeSubscriptionId === subscriptionId && existing.plan === planValue) {
      return { workspaceId: meta.workspaceId, plan: planValue };
    }

    const policy = await enforceTrialPolicy({
      subscriptionId,
      userId: meta.userId,
      userEmail: initiatingUser.email,
    });
    // Ineligible trial that did not pay (subscription canceled): grant nothing —
    // the workspace stays on its current plan.
    if (policy.abort) {
      console.warn(
        `[billing/provision] not upgrading workspace ${meta.workspaceId}: subscription ${subscriptionId} was canceled (unpaid)`,
      );
      return null;
    }
    const priceId = policy.subscription.items.data[0]?.price.id ?? null;
    // Paid immediately (no trial) vs starting a trial. Backfill expansion and the
    // firstPaidAt marker only happen on real payment: during a trial the backfill
    // stays at the FREE cap (payment gate), so re-scanning now would import nothing
    // and needlessly burn the inbox's one rolling grace. The trial-conversion payment
    // triggers the re-scan later via the invoice.payment_succeeded webhook.
    const paidNow = policy.trialEndsAt == null && policy.subscription.status === "active";

    await db.$transaction([
      db.workspace.update({
        where: { id: meta.workspaceId },
        data: {
          plan: planValue,
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscriptionId,
          stripePriceId: priceId,
          billingCycle: cycleValue,
          trialEndsAt: policy.trialEndsAt,
          currentPeriodEnd: subscriptionPeriodEnd(policy.subscription),
          cancelAtPeriodEnd: false,
          paymentFailed: false,
        },
      }),
      // Only on immediate payment: re-scan up to the (now ungated) plan cap and stamp
      // firstPaidAt. The worker's sync scheduler re-enqueues a backfill whenever the
      // status is PENDING; re-ingesting stored threads is idempotent. No-op when the
      // workspace has no connected inbox yet. firstPaidAt is set via a null-guarded
      // updateMany so a re-subscribe never overwrites the original first-payment date.
      ...(paidNow
        ? [
            db.providerSyncState.updateMany({
              where: { emailAccount: { workspaceId: meta.workspaceId } },
              data: BACKFILL_RESCAN_RESET,
            }),
            db.workspace.updateMany({
              where: { id: meta.workspaceId, firstPaidAt: null },
              data: { firstPaidAt: new Date() },
            }),
          ]
        : []),
      // Mark the trial consumed whenever it was granted OR denied — a denied user
      // should stop being offered a trial they can't get.
      ...(policy.trialOutcome !== "none"
        ? [db.user.update({ where: { id: meta.userId }, data: { trialUsed: true } })]
        : []),
    ]);
    await db.auditLog.create({
      data: {
        workspaceId: meta.workspaceId,
        actorType: "USER",
        actorUserId: meta.userId,
        eventType: "workspace.plan.upgraded",
        entityType: "Workspace",
        entityId: meta.workspaceId,
        metadata: { plan: meta.plan, cycle: meta.cycle, subscriptionId, trial: policy.trialOutcome },
      },
    });
    if (policy.reason) {
      await writeTrialDeniedAudit(meta.workspaceId, meta.userId, subscriptionId, policy.reason);
    }
    return { workspaceId: meta.workspaceId, plan: planValue };
  }

  // action === "create"
  const existing = await db.workspace.findFirst({
    where: { stripeSubscriptionId: subscriptionId },
    select: { id: true },
  });
  if (existing) return { workspaceId: existing.id, plan: planValue };

  const policy = await enforceTrialPolicy({
    subscriptionId,
    userId: meta.userId,
    userEmail: initiatingUser.email,
  });
  // Ineligible trial that did not pay (subscription canceled): create nothing.
  if (policy.abort) {
    console.warn(
      `[billing/provision] not creating workspace for user ${meta.userId}: subscription ${subscriptionId} was canceled (unpaid)`,
    );
    return null;
  }
  const priceId = policy.subscription.items.data[0]?.price.id ?? null;
  // Immediate payment stamps firstPaidAt now; a trial leaves it null until the
  // trial-conversion payment arrives via the invoice.payment_succeeded webhook.
  const paidNow = policy.trialEndsAt == null && policy.subscription.status === "active";

  let workspace: { id: string };
  try {
    workspace = await db.workspace.create({
      data: {
        name: meta.newWorkspaceName || "My Workspace",
        ownerUserId: meta.userId,
        plan: planValue,
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscriptionId,
        stripePriceId: priceId,
        billingCycle: cycleValue,
        trialEndsAt: policy.trialEndsAt,
        currentPeriodEnd: subscriptionPeriodEnd(policy.subscription),
        firstPaidAt: paidNow ? new Date() : null,
        members: { create: { userId: meta.userId, role: "OWNER" } },
      },
      select: { id: true },
    });
  } catch (err) {
    // A concurrent caller (webhook vs success page vs confirm-checkout) may have
    // created the workspace first — stripeSubscriptionId is unique. Return theirs.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const raced = await db.workspace.findFirst({
        where: { stripeSubscriptionId: subscriptionId },
        select: { id: true },
      });
      if (raced) return { workspaceId: raced.id, plan: planValue };
    }
    throw err;
  }

  if (policy.trialOutcome !== "none") {
    await db.user.update({ where: { id: meta.userId }, data: { trialUsed: true } });
  }
  await ensureInboxTaxonomy(workspace.id);
  await db.auditLog.create({
    data: {
      workspaceId: workspace.id,
      actorType: "USER",
      actorUserId: meta.userId,
      eventType: "workspace.created.paid",
      entityType: "Workspace",
      entityId: workspace.id,
      metadata: { plan: meta.plan, cycle: meta.cycle, subscriptionId, trial: policy.trialOutcome },
    },
  });
  if (policy.reason) {
    await writeTrialDeniedAudit(workspace.id, meta.userId, subscriptionId, policy.reason);
  }
  return { workspaceId: workspace.id, plan: planValue };
}
