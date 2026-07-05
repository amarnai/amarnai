import Stripe from "stripe";
import { getStripe } from "./stripe.js";

/** A Stripe "this subscription no longer exists" error — treat as already done. */
function isResourceMissing(err: unknown): boolean {
  return err instanceof Stripe.errors.StripeInvalidRequestError && err.code === "resource_missing";
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

/** Bound an error message before persisting it as diagnostic `lastError`. */
export function clampError(message: string | undefined): string | null {
  return message ? message.slice(0, 500) : null;
}

export type EnsureCanceledResult = { done: true } | { done: false; error: Error };

/**
 * Ensure a Stripe subscription can no longer bill, autonomously and idempotently.
 *
 * The goal is not "the cancel call returned 200" but "this subscription will never
 * charge again", so we retrieve first and treat every terminal state as success:
 *   - subscription already `canceled`, or gone (`resource_missing`) → done.
 *   - otherwise cancel it → done.
 *   - a transient error (network / 5xx / rate limit) → not done; the caller keeps
 *     the pending record and retries later.
 *
 * The only non-self-resolving case is invalid Stripe credentials, which is a
 * platform-wide outage (loud by nature) that drains every stuck row automatically
 * once the key is fixed — so no per-subscription human intervention is ever needed.
 */
export async function ensureSubscriptionCanceled(
  subscriptionId: string,
): Promise<EnsureCanceledResult> {
  const stripe = getStripe();

  let subscription: Stripe.Subscription;
  try {
    subscription = await stripe.subscriptions.retrieve(subscriptionId);
  } catch (err) {
    if (isResourceMissing(err)) return { done: true };
    return { done: false, error: toError(err) };
  }

  if (subscription.status === "canceled") return { done: true };

  try {
    await stripe.subscriptions.cancel(subscriptionId);
    return { done: true };
  } catch (err) {
    if (isResourceMissing(err)) return { done: true };
    return { done: false, error: toError(err) };
  }
}
