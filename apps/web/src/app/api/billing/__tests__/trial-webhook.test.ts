// Stripe's webhook signing methods (constructEvent, generateTestHeaderString) are local
// HMAC-SHA256 operations — no network calls. We create a real Stripe instance with
// vi.hoisted so it is available inside the vi.mock factory and in the test body.
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import type Stripe from "stripe";

const { testStripe } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Lib = require("stripe");
  const StripeClass = (Lib.default ?? Lib) as typeof import("stripe").default;
  return { testStripe: new StripeClass("sk_test_placeholder") };
});

vi.mock("@/lib/stripe", () => ({
  getStripe: () => testStripe,
  getPriceId: vi.fn(),
}));

const { MockPrismaKnownRequestError } = vi.hoisted(() => {
  class MockPrismaKnownRequestError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
    }
  }
  return { MockPrismaKnownRequestError };
});

vi.mock("@amarnai/db", () => ({
  db: {
    workspace: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    workspaceMember: { deleteMany: vi.fn() },
    user: { findUnique: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn() },
    providerSyncState: { updateMany: vi.fn() },
    pendingSubscriptionCancellation: { upsert: vi.fn() },
    $transaction: vi.fn(),
  },
  ensureInboxTaxonomy: vi.fn(),
  claimTrial: vi.fn(),
  Prisma: { PrismaClientKnownRequestError: MockPrismaKnownRequestError },
}));

import { db, ensureInboxTaxonomy, claimTrial } from "@amarnai/db";
import { POST } from "@/app/api/billing/webhook/route";

const WEBHOOK_SECRET = "test_signing_secret_not_real";
const USER_ID = "user-1";
const WS_ID = "ws-1";
const SUB_ID = "sub_test_123";
const CUSTOMER_ID = "cus_test_123";
const PRICE_ID = "price_test_pro_monthly";

const FUTURE_TS = Math.floor(Date.now() / 1000) + 14 * 24 * 60 * 60;

const SUBSCRIPTION_WITH_TRIAL = {
  id: SUB_ID,
  object: "subscription",
  status: "trialing",
  trial_end: FUTURE_TS,
  cancel_at_period_end: false,
  items: {
    object: "list",
    data: [{ id: "si_1", price: { id: PRICE_ID }, current_period_end: FUTURE_TS }],
  },
} as unknown as Stripe.Subscription;

const SUBSCRIPTION_WITHOUT_TRIAL = {
  id: SUB_ID,
  object: "subscription",
  status: "active",
  trial_end: null,
  cancel_at_period_end: false,
  items: {
    object: "list",
    data: [{ id: "si_1", price: { id: PRICE_ID }, current_period_end: FUTURE_TS }],
  },
} as unknown as Stripe.Subscription;

function makeUpgradeCheckoutEvent(subscriptionId = SUB_ID): Stripe.Event {
  return {
    id: "evt_test_upgrade",
    object: "event",
    type: "checkout.session.completed",
    api_version: "2026-05-27.dahlia",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 0,
    request: null,
    data: {
      object: {
        id: "cs_test_123",
        object: "checkout.session",
        subscription: subscriptionId,
        customer: CUSTOMER_ID,
        metadata: {
          userId: USER_ID,
          workspaceId: WS_ID,
          action: "upgrade",
          plan: "pro",
          cycle: "monthly",
          newWorkspaceName: "",
        },
      } as unknown as Stripe.Checkout.Session,
    },
  } as Stripe.Event;
}

function makeCreateCheckoutEvent(subscriptionId = SUB_ID): Stripe.Event {
  return {
    id: "evt_test_create",
    object: "event",
    type: "checkout.session.completed",
    api_version: "2026-05-27.dahlia",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 0,
    request: null,
    data: {
      object: {
        id: "cs_test_456",
        object: "checkout.session",
        subscription: subscriptionId,
        customer: CUSTOMER_ID,
        metadata: {
          userId: USER_ID,
          workspaceId: "",
          action: "create",
          plan: "pro",
          cycle: "monthly",
          newWorkspaceName: "My New Workspace",
        },
      } as unknown as Stripe.Checkout.Session,
    },
  } as Stripe.Event;
}

function makeSubscriptionDeletedEvent(subscriptionId = SUB_ID): Stripe.Event {
  return {
    id: "evt_test_deleted",
    object: "event",
    type: "customer.subscription.deleted",
    api_version: "2026-05-27.dahlia",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 0,
    request: null,
    data: {
      object: {
        id: subscriptionId,
        object: "subscription",
        status: "canceled",
        cancel_at_period_end: false,
        items: { object: "list", data: [] },
      } as unknown as Stripe.Subscription,
    },
  } as Stripe.Event;
}

function makeSubscriptionUpdatedCancelDuringTrialEvent(subscriptionId = SUB_ID): Stripe.Event {
  return {
    id: "evt_test_updated",
    object: "event",
    type: "customer.subscription.updated",
    api_version: "2026-05-27.dahlia",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 0,
    request: null,
    data: {
      object: {
        id: subscriptionId,
        object: "subscription",
        status: "trialing",
        cancel_at_period_end: true,
        items: { object: "list", data: [] },
      } as unknown as Stripe.Subscription,
    },
  } as Stripe.Event;
}

// Uses the real Stripe SDK to generate a valid HMAC-SHA256 webhook signature.
function webhookRequest(event: Stripe.Event) {
  const payload = JSON.stringify(event);
  const sig = testStripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  return new Request("http://localhost/api/billing/webhook", {
    method: "POST",
    headers: { "stripe-signature": sig },
    body: payload,
  });
}

beforeEach(() => {
  vi.clearAllMocks();

  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;

  // $transaction resolves each operation in the array
  vi.mocked(db.$transaction).mockResolvedValue([] as never);
  vi.mocked(db.workspace.update).mockResolvedValue({} as never);
  vi.mocked(db.workspace.create).mockResolvedValue({ id: WS_ID } as never);
  vi.mocked(db.workspace.findFirst).mockResolvedValue(null);
  // Upgrade-path idempotency probe in provisionFromCheckoutSession: default to an
  // unprovisioned workspace so provisioning proceeds.
  vi.mocked(db.workspace.findUnique).mockResolvedValue(null);
  vi.mocked(db.user.findUnique).mockResolvedValue({ id: USER_ID, email: "user@example.com" } as never);
  vi.mocked(db.user.update).mockResolvedValue({} as never);
  vi.mocked(db.workspaceMember.deleteMany).mockResolvedValue({ count: 0 } as never);
  vi.mocked(db.auditLog.create).mockResolvedValue({} as never);
  vi.mocked(db.pendingSubscriptionCancellation.upsert).mockResolvedValue({} as never);
  vi.mocked(ensureInboxTaxonomy).mockResolvedValue(undefined as never);

  // Default: the trial claim is granted (fresh identity).
  vi.mocked(claimTrial).mockResolvedValue({ granted: true } as never);

  vi.spyOn(testStripe.subscriptions, "retrieve").mockResolvedValue(
    SUBSCRIPTION_WITH_TRIAL as never
  );
  // Default: stripping a denied trial settles payment (status active).
  vi.spyOn(testStripe.subscriptions, "update").mockResolvedValue(
    SUBSCRIPTION_WITHOUT_TRIAL as never
  );
  vi.spyOn(testStripe.subscriptions, "cancel").mockResolvedValue(
    { id: SUB_ID, status: "canceled" } as never
  );
});

afterEach(() => {
  delete process.env.STRIPE_WEBHOOK_SECRET;
});

describe("checkout.session.completed — upgrade action", () => {
  it("sets user.trialUsed = true when subscription includes a trial period", async () => {
    vi.spyOn(testStripe.subscriptions, "retrieve").mockResolvedValue(
      SUBSCRIPTION_WITH_TRIAL as never
    );

    const res = await POST(webhookRequest(makeUpgradeCheckoutEvent()));

    expect(res.status).toBe(200);
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { trialUsed: true },
    });
  });

  it("does not set user.trialUsed when subscription has no trial period", async () => {
    vi.spyOn(testStripe.subscriptions, "retrieve").mockResolvedValue(
      SUBSCRIPTION_WITHOUT_TRIAL as never
    );

    const res = await POST(webhookRequest(makeUpgradeCheckoutEvent()));

    expect(res.status).toBe(200);
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("updates workspace plan and billing fields on successful checkout", async () => {
    vi.spyOn(testStripe.subscriptions, "retrieve").mockResolvedValue(
      SUBSCRIPTION_WITH_TRIAL as never
    );

    await POST(webhookRequest(makeUpgradeCheckoutEvent()));

    expect(db.workspace.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: WS_ID },
        data: expect.objectContaining({ plan: "PRO", stripeSubscriptionId: SUB_ID }),
      })
    );
  });

  it("resets the backfill so the higher plan cap re-scans the inbox", async () => {
    vi.spyOn(testStripe.subscriptions, "retrieve").mockResolvedValue(
      SUBSCRIPTION_WITH_TRIAL as never
    );

    await POST(webhookRequest(makeUpgradeCheckoutEvent()));

    expect(db.providerSyncState.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { emailAccount: { workspaceId: WS_ID } },
        data: expect.objectContaining({
          backfillStatus: "PENDING",
          backfillCapReached: false,
          backfillBeyondCount: 0,
        }),
      })
    );
  });
});

describe("checkout.session.completed — create action", () => {
  it("sets user.trialUsed = true when new workspace is created with a trial", async () => {
    vi.spyOn(testStripe.subscriptions, "retrieve").mockResolvedValue(
      SUBSCRIPTION_WITH_TRIAL as never
    );
    // Ensure no duplicate workspace for this subscription
    vi.mocked(db.workspace.findFirst).mockResolvedValue(null);

    const res = await POST(webhookRequest(makeCreateCheckoutEvent()));

    expect(res.status).toBe(200);
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { trialUsed: true },
    });
  });

  it("does not set user.trialUsed when new workspace is created without a trial", async () => {
    vi.spyOn(testStripe.subscriptions, "retrieve").mockResolvedValue(
      SUBSCRIPTION_WITHOUT_TRIAL as never
    );
    vi.mocked(db.workspace.findFirst).mockResolvedValue(null);

    const res = await POST(webhookRequest(makeCreateCheckoutEvent()));

    expect(res.status).toBe(200);
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("is idempotent: ignores duplicate checkout events for the same subscription", async () => {
    // Simulate a workspace that was already created for this subscription
    vi.mocked(db.workspace.findFirst).mockResolvedValue({ id: WS_ID } as never);

    const res = await POST(webhookRequest(makeCreateCheckoutEvent()));

    expect(res.status).toBe(200);
    expect(db.workspace.create).not.toHaveBeenCalled();
    expect(db.user.update).not.toHaveBeenCalled();
  });
});

describe("checkout.session.completed — orphaned payment (user gone)", () => {
  it("acknowledges with 200 and provisions nothing when the initiating user no longer exists", async () => {
    // Account deleted between checkout and this event: provisioning would violate
    // the ownerUserId FK. The handler must not throw (which would make Stripe
    // retry forever); it logs for reconciliation and acks.
    vi.mocked(db.user.findUnique).mockResolvedValue(null);

    const res = await POST(webhookRequest(makeCreateCheckoutEvent()));

    expect(res.status).toBe(200);
    expect(db.workspace.create).not.toHaveBeenCalled();
    expect(db.workspace.update).not.toHaveBeenCalled();
    expect(db.user.update).not.toHaveBeenCalled();
    // The orphaned subscription is queued for cancellation so it cannot keep
    // billing a vanished account.
    expect(db.pendingSubscriptionCancellation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { stripeSubscriptionId: SUB_ID },
        create: expect.objectContaining({ stripeSubscriptionId: SUB_ID }),
      })
    );
  });
});

describe("checkout.session.completed — trial enforcement at redemption", () => {
  it("retrieves the subscription expanding both card sources (subscription + customer default PM)", async () => {
    const retrieveSpy = vi.spyOn(testStripe.subscriptions, "retrieve").mockResolvedValue(
      SUBSCRIPTION_WITH_TRIAL as never
    );

    await POST(webhookRequest(makeUpgradeCheckoutEvent()));

    expect(retrieveSpy).toHaveBeenCalledWith(SUB_ID, {
      expand: ["default_payment_method", "customer.invoice_settings.default_payment_method"],
    });
  });

  it("falls back to the customer's default payment method for the card fingerprint", async () => {
    // Trial subs collected via Checkout usually have no subscription-level default
    // PM; the card lives on the customer's invoice_settings. The fingerprint must
    // still reach claimTrial.
    vi.spyOn(testStripe.subscriptions, "retrieve").mockResolvedValue({
      id: SUB_ID,
      status: "trialing",
      trial_end: FUTURE_TS,
      default_payment_method: null,
      customer: {
        id: CUSTOMER_ID,
        invoice_settings: { default_payment_method: { card: { fingerprint: "fp_customer" } } },
      },
      items: { data: [{ id: "si_1", price: { id: PRICE_ID }, current_period_end: FUTURE_TS }] },
    } as never);

    await POST(webhookRequest(makeUpgradeCheckoutEvent()));

    expect(claimTrial).toHaveBeenCalledWith(
      expect.objectContaining({ stripeSubscriptionId: SUB_ID, cardFingerprint: "fp_customer" })
    );
  });

  it("grants the trial when claimTrial succeeds: trialEndsAt is set and trial audit says granted", async () => {
    vi.mocked(claimTrial).mockResolvedValue({ granted: true } as never);

    await POST(webhookRequest(makeUpgradeCheckoutEvent()));

    // Workspace keeps a future trialEndsAt.
    const wsUpdate = vi.mocked(db.workspace.update).mock.calls[0]?.[0];
    expect(wsUpdate?.data).toEqual(expect.objectContaining({ trialEndsAt: expect.any(Date) }));
    // No strip of the trial.
    expect(testStripe.subscriptions.update).not.toHaveBeenCalled();
    // Audit records the granted outcome.
    expect(db.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ metadata: expect.objectContaining({ trial: "granted" }) }),
      })
    );
  });

  it("denies a reused-email trial: strips trial_end to now, still marks trialUsed, writes a denied audit", async () => {
    vi.mocked(claimTrial).mockResolvedValue({ granted: false, reason: "email_claimed" } as never);

    const res = await POST(webhookRequest(makeUpgradeCheckoutEvent()));

    expect(res.status).toBe(200);
    // Trial stripped immediately so the subscription bills now.
    expect(testStripe.subscriptions.update).toHaveBeenCalledWith(SUB_ID, {
      trial_end: "now",
      proration_behavior: "none",
    });
    // Workspace provisioned with no trial.
    const wsUpdate = vi.mocked(db.workspace.update).mock.calls[0]?.[0];
    expect(wsUpdate?.data).toEqual(expect.objectContaining({ trialEndsAt: null }));
    // trialUsed is still set so the UI stops offering a trial they can't get.
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: USER_ID }, data: { trialUsed: true } });
    // A dedicated denied audit is written.
    expect(db.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: "billing.trial.denied",
          metadata: expect.objectContaining({ reason: "email_claimed" }),
        }),
      })
    );
  });

  it("denied trial that does NOT settle payment is canceled and provisions nothing (no dunning free access)", async () => {
    vi.mocked(claimTrial).mockResolvedValue({ granted: false, reason: "email_claimed" } as never);
    // Ending the trial leaves the subscription unpaid (past_due), not active.
    vi.spyOn(testStripe.subscriptions, "update").mockResolvedValue(
      { id: SUB_ID, status: "past_due", trial_end: null, items: { data: [{ id: "si_1", price: { id: PRICE_ID } }] } } as never
    );
    const cancelSpy = vi.spyOn(testStripe.subscriptions, "cancel").mockResolvedValue(
      { id: SUB_ID, status: "canceled" } as never
    );

    const res = await POST(webhookRequest(makeUpgradeCheckoutEvent()));

    expect(res.status).toBe(200);
    // The ineligible, unpaid subscription is canceled outright.
    expect(cancelSpy).toHaveBeenCalledWith(SUB_ID);
    // No paid access is granted — the workspace is never updated.
    expect(db.workspace.update).not.toHaveBeenCalled();
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("does not re-provision an already-canceled subscription (abort on redelivery)", async () => {
    // A redelivery after a prior denied+unpaid attempt: the subscription is dead.
    vi.spyOn(testStripe.subscriptions, "retrieve").mockResolvedValue(
      { id: SUB_ID, status: "canceled", trial_end: null, items: { data: [{ id: "si_1", price: { id: PRICE_ID } }] } } as never
    );

    const res = await POST(webhookRequest(makeUpgradeCheckoutEvent()));

    expect(res.status).toBe(200);
    expect(db.workspace.update).not.toHaveBeenCalled();
    // claimTrial is never reached for a dead subscription.
    expect(claimTrial).not.toHaveBeenCalled();
  });

  it("returns 500 (Stripe redelivers) when stripping a denied trial fails and the trial is still active", async () => {
    vi.mocked(claimTrial).mockResolvedValue({ granted: false, reason: "card_claimed" } as never);
    vi.spyOn(testStripe.subscriptions, "update").mockRejectedValue(new Error("stripe down"));
    // The re-retrieve inside enforceTrialPolicy still shows a live trial → genuine failure.
    vi.spyOn(testStripe.subscriptions, "retrieve").mockResolvedValue(
      SUBSCRIPTION_WITH_TRIAL as never
    );

    const res = await POST(webhookRequest(makeUpgradeCheckoutEvent()));

    expect(res.status).toBe(500);
    expect(db.workspace.update).not.toHaveBeenCalled();
  });

  it("create path is race-safe: a P2002 on workspace.create returns the workspace the winner created", async () => {
    vi.mocked(db.workspace.findFirst)
      .mockResolvedValueOnce(null) // initial idempotency probe: not yet created
      .mockResolvedValueOnce({ id: WS_ID } as never); // after P2002: the winner's workspace
    vi.mocked(db.workspace.create).mockRejectedValue(
      new MockPrismaKnownRequestError("Unique constraint failed", "P2002")
    );

    const res = await POST(webhookRequest(makeCreateCheckoutEvent()));

    expect(res.status).toBe(200);
    // No second workspace, no double taxonomy seeding.
    expect(ensureInboxTaxonomy).not.toHaveBeenCalled();
  });
});

describe("customer.subscription.deleted", () => {
  it("downgrades workspace to FREE without touching user.trialUsed", async () => {
    vi.mocked(db.workspace.findFirst).mockResolvedValue({ id: WS_ID } as never);

    const res = await POST(webhookRequest(makeSubscriptionDeletedEvent()));

    expect(res.status).toBe(200);
    expect(db.workspace.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ plan: "FREE" }),
      })
    );
    // trialUsed is never cleared — user keeps their consumed trial status
    const updateArg = vi.mocked(db.workspace.update).mock.calls[0]?.[0];
    expect(updateArg?.data).not.toHaveProperty("trialUsed");
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("is a no-op when no workspace matches the subscription", async () => {
    vi.mocked(db.workspace.findFirst).mockResolvedValue(null);

    const res = await POST(webhookRequest(makeSubscriptionDeletedEvent()));

    expect(res.status).toBe(200);
    expect(db.workspace.update).not.toHaveBeenCalled();
  });
});

describe("customer.subscription.updated — cancel during trial", () => {
  it("immediately downgrades workspace to FREE without touching user.trialUsed", async () => {
    vi.mocked(db.workspace.findFirst).mockResolvedValue({ id: WS_ID } as never);

    const res = await POST(webhookRequest(makeSubscriptionUpdatedCancelDuringTrialEvent()));

    expect(res.status).toBe(200);
    // Workspace is reverted to FREE
    expect(db.workspace.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ plan: "FREE" }),
      })
    );
    // user.trialUsed is preserved (already set to true by the earlier checkout webhook)
    const updateArg = vi.mocked(db.workspace.update).mock.calls[0]?.[0];
    expect(updateArg?.data).not.toHaveProperty("trialUsed");
    expect(db.user.update).not.toHaveBeenCalled();
  });
});

describe("webhook signature verification", () => {
  it("rejects requests with a missing stripe-signature header", async () => {
    const req = new Request("http://localhost/api/billing/webhook", {
      method: "POST",
      body: JSON.stringify(makeUpgradeCheckoutEvent()),
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it("rejects requests with a tampered payload", async () => {
    const event = makeUpgradeCheckoutEvent();
    const payload = JSON.stringify(event);
    const sig = testStripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });

    // Tamper with the payload after signature was generated
    const tamperedPayload = payload.replace(USER_ID, "attacker-id");

    const req = new Request("http://localhost/api/billing/webhook", {
      method: "POST",
      headers: { "stripe-signature": sig },
      body: tamperedPayload,
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
    expect(db.user.update).not.toHaveBeenCalled();
  });
});
