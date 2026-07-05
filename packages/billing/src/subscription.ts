import type Stripe from "stripe";

/**
 * The subscription's current period end as a Date, or null when unavailable.
 *
 * In Stripe API v2025+ `current_period_end` moved off the subscription and onto
 * each subscription item, so it is read from the first item. Single source of
 * truth for the several billing call sites that persist `currentPeriodEnd`.
 */
export function subscriptionPeriodEnd(subscription: Stripe.Subscription): Date | null {
  const item = subscription.items.data[0];
  return item?.current_period_end ? new Date(item.current_period_end * 1000) : null;
}
