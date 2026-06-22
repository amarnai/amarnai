import type { BillingState, PlanId, BillingCycle } from '@amarnai/shared';
import { secureTokenStore } from '../auth/tokenStore';
import { WEB_APP_URL } from '../config';

// Billing actions live on the web Next app (where Stripe + the webhook run), not
// the API server. Mobile reaches them at WEB_APP_URL/api/billing/* carrying a
// signed JWT; the endpoints accept Bearer auth alongside the web's cookie session.

export interface BillingResult<T> {
  ok: boolean;
  status: number;
  data: T & { error?: string };
}

async function billingRequest<T = Record<string, unknown>>(
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown },
): Promise<BillingResult<T>> {
  const tokens = await secureTokenStore.get();
  const res = await fetch(`${WEB_APP_URL}/api/billing/${path}`, {
    method: init.method,
    headers: {
      'Content-Type': 'application/json',
      ...(tokens?.accessToken ? { Authorization: `Bearer ${tokens.accessToken}` } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });

  // Endpoints return JSON on success and for handled errors, but an unconfigured
  // Stripe (no STRIPE_SECRET_KEY) surfaces as a 500 with a non-JSON body. Read
  // the real reason rather than masking it.
  const raw = await res.text();
  let data: T & { error?: string };
  try {
    data = JSON.parse(raw) as T & { error?: string };
  } catch {
    data = {} as T & { error?: string };
  }
  return { ok: res.ok, status: res.status, data };
}

export interface StartCheckoutInput {
  action: 'create' | 'upgrade';
  plan: Exclude<PlanId, 'free'>;
  cycle: BillingCycle;
  workspaceId?: string;
  newWorkspaceName?: string;
}

/** Create a Stripe Checkout session (browser) or apply a paid->paid upgrade directly. */
export function startCheckout(input: StartCheckoutInput) {
  return billingRequest<{ url?: string; upgraded?: boolean; sessionId?: string }>(
    'create-checkout-session',
    { method: 'POST', body: input },
  );
}

/**
 * Confirm a completed Checkout session on return from the browser so the upgrade
 * lands without waiting on the Stripe webhook. `pending` means payment isn't
 * finished yet (retry on the next foreground).
 */
export function confirmCheckout(sessionId: string) {
  return billingRequest<{ provisioned?: boolean; pending?: boolean; plan?: string; workspaceId?: string }>(
    'confirm-checkout',
    { method: 'POST', body: { sessionId } },
  );
}

/** In-app downgrade to a lower-or-equal paid tier (no payment, no browser). */
export function changePlan(input: {
  workspaceId: string;
  plan: Exclude<PlanId, 'free'>;
  cycle: BillingCycle;
}) {
  return billingRequest<{ changed?: boolean; membersToRemove?: { name: string | null; email: string }[] }>(
    'change-plan',
    { method: 'POST', body: input },
  );
}

/** Cancel the subscription (downgrade to Free). In-app, no browser. */
export function cancelSubscription(workspaceId: string) {
  return billingRequest<{ immediateDowngrade?: boolean }>('cancel-subscription', {
    method: 'POST',
    body: { workspaceId },
  });
}

/** Open the Stripe billing portal (browser) for payment-method management. */
export function createPortalSession(workspaceId: string) {
  return billingRequest<{ url?: string }>('create-portal-session', {
    method: 'POST',
    body: { workspaceId },
  });
}

/** Read the workspace's billing display state (reconciled with Stripe). */
export async function getBillingState(workspaceId: string): Promise<BillingState> {
  const res = await billingRequest<BillingState>(
    `state?workspaceId=${encodeURIComponent(workspaceId)}`,
    { method: 'GET' },
  );
  if (!res.ok) {
    throw new Error(res.data.error ?? 'Could not load billing. Please try again.');
  }
  return res.data;
}
