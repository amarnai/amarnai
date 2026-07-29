import type { PlanId, BillingCycle } from "@amarnai/shared";
import { extensionTokenStore } from "../auth/tokenStore";
import { WEB_APP_URL } from "../config";

// Billing actions live on the web Next app (where Stripe and its webhook run),
// not the API server. The panel reaches them at WEB_APP_URL/api/billing/*
// carrying its access token; those routes accept Bearer auth alongside the web's
// cookie session (see apps/web/src/lib/billing-auth.ts). Those Next routes send
// no CORS headers, so this only works because the manifest holds a host
// permission for the web-app origin.

export interface BillingResult<T> {
  ok: boolean;
  status: number;
  data: T & { error?: string };
}

async function billingRequest<T = Record<string, unknown>>(
  path: string,
  init: { method: "GET" | "POST"; body?: unknown }
): Promise<BillingResult<T>> {
  const tokens = await extensionTokenStore.get();
  const res = await fetch(`${WEB_APP_URL}/api/billing/${path}`, {
    method: init.method,
    headers: {
      "Content-Type": "application/json",
      ...(tokens?.accessToken ? { Authorization: `Bearer ${tokens.accessToken}` } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });

  // Endpoints return JSON on success and for handled errors, but an unconfigured
  // Stripe (no STRIPE_SECRET_KEY, as on most self-hosted deployments) surfaces as
  // a 500 with a non-JSON body. Read the real reason rather than masking it.
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
  action: "create" | "upgrade";
  plan: Exclude<PlanId, "free">;
  cycle: BillingCycle;
  workspaceId?: string;
  newWorkspaceName?: string;
  /**
   * The mailbox this user works in, so Stripe's return page can offer a way
   * back to it. Sent from here because the panel knows it directly; a workspace
   * bought for a brand-new team has no connection for the server to infer it
   * from.
   */
  mailProvider?: "GMAIL" | "OUTLOOK";
}

export type StartCheckoutResult = {
  /** Present when Stripe Checkout must be opened in a tab. */
  url?: string;
  /** True for a paid-to-paid change applied directly, with no Stripe redirect. */
  upgraded?: boolean;
  sessionId?: string;
};

/** Create a Stripe Checkout session, or apply a paid-to-paid upgrade directly. */
export function startCheckout(input: StartCheckoutInput) {
  return billingRequest<StartCheckoutResult>("create-checkout-session", {
    method: "POST",
    // `source` rides along so Stripe's return page knows the user came from the
    // panel and should be pointed back at their mailbox rather than deeper into
    // the web app.
    body: { ...input, source: "extension" },
  });
}

/**
 * Confirm a completed Checkout session so the upgrade lands without waiting on
 * the Stripe webhook. `pending` means payment is not finished yet, so the caller
 * should retry the next time the panel regains focus.
 */
export function confirmCheckout(sessionId: string) {
  return billingRequest<{
    provisioned?: boolean;
    /** Payment is not finished; ask again later. */
    pending?: boolean;
    /** Stripe will never complete this session; stop watching it. */
    expired?: boolean;
    plan?: string;
    workspaceId?: string;
  }>("confirm-checkout", { method: "POST", body: { sessionId } });
}
