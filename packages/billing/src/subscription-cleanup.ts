import { db } from "@amarnai/db";
import { isStripeConfigured } from "./stripe.js";
import { ensureSubscriptionCanceled } from "./cancel-subscription.js";

/** Keep lastError bounded — it is diagnostic, not a payload. */
function clampError(message: string | undefined): string | null {
  return message ? message.slice(0, 500) : null;
}

async function recordPending(
  stripeSubscriptionId: string,
  userId: string,
  errorMessage: string | undefined,
): Promise<void> {
  const now = new Date();
  await db.pendingSubscriptionCancellation.upsert({
    where: { stripeSubscriptionId },
    create: {
      stripeSubscriptionId,
      userId,
      attempts: 1,
      lastError: clampError(errorMessage),
      lastAttemptAt: now,
    },
    update: {
      attempts: { increment: 1 },
      lastError: clampError(errorMessage),
      lastAttemptAt: now,
    },
  });
}

/**
 * Cancel every Stripe subscription on workspaces owned by this user, as part of
 * account deletion. NEVER throws and never blocks deletion: a Stripe failure (or
 * Stripe being unconfigured while a subscription somehow exists) records a durable
 * PendingSubscriptionCancellation that the worker retries until the subscription
 * can no longer bill — so a deleted account can never keep paying.
 *
 * MUST run before deleteUserCascade, while the workspace rows still exist.
 */
export async function cancelSubscriptionsForAccountDeletion(userId: string): Promise<void> {
  const workspaces = await db.workspace.findMany({
    where: { ownerUserId: userId, stripeSubscriptionId: { not: null } },
    select: { stripeSubscriptionId: true },
  });

  for (const ws of workspaces) {
    const subscriptionId = ws.stripeSubscriptionId!;

    if (!isStripeConfigured()) {
      // Shouldn't happen (no Stripe key but a subscription id present), but record
      // it so the row is reconciled if billing is ever configured later.
      await recordPending(subscriptionId, userId, "Stripe not configured at deletion time");
      continue;
    }

    const result = await ensureSubscriptionCanceled(subscriptionId);
    if (result.done) {
      // The workspace's AuditLog rows are about to be cascaded away, so the log
      // line plus the (absence of a) pending row is the record of cancellation.
      console.log(`[billing/cleanup] Canceled subscription ${subscriptionId} for deleted account`);
    } else {
      await recordPending(subscriptionId, userId, result.error.message);
      console.warn(
        `[billing/cleanup] Could not cancel ${subscriptionId} at deletion; queued for retry: ${result.error.message}`,
      );
    }
  }
}
