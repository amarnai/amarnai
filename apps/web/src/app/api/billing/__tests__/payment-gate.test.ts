// Tests the first-payment gate in the invoice.payment_succeeded webhook: the first
// non-zero payment stamps Workspace.firstPaidAt (unlocking the plan backfill cap) and
// triggers a one-time backfill re-scan, idempotently across webhook redeliveries.
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import type Stripe from "stripe";

const { testStripe } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Lib = require("stripe");
  const StripeClass = (Lib.default ?? Lib) as typeof import("stripe").default;
  return { testStripe: new StripeClass("sk_test_placeholder") };
});

vi.mock("@/lib/stripe", () => ({ getStripe: () => testStripe, getPriceId: vi.fn() }));

vi.mock("@aziru/db", () => ({
  db: {
    workspace: { findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    providerSyncState: { updateMany: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
  ensureInboxTaxonomy: vi.fn(),
  claimTrial: vi.fn(),
  Prisma: { PrismaClientKnownRequestError: class extends Error {} },
}));

import { db } from "@aziru/db";
import { POST } from "@/app/api/billing/webhook/route";

const WEBHOOK_SECRET = "test_signing_secret_not_real";
const WS_ID = "ws-1";
const SUB_ID = "sub_test_123";

function makePaymentSucceededEvent(amountPaid: number): Stripe.Event {
  return {
    id: "evt_test_paid",
    object: "event",
    type: "invoice.payment_succeeded",
    api_version: "2026-05-27.dahlia",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 0,
    request: null,
    data: {
      object: {
        id: "in_test_123",
        object: "invoice",
        amount_paid: amountPaid,
        period_end: Math.floor(Date.now() / 1000),
        parent: {
          type: "subscription_details",
          subscription_details: { subscription: SUB_ID },
        },
      } as unknown as Stripe.Invoice,
    },
  } as Stripe.Event;
}

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
  vi.mocked(db.workspace.findFirst).mockResolvedValue({ id: WS_ID } as never);
  vi.mocked(db.workspace.update).mockResolvedValue({} as never);
  vi.mocked(db.providerSyncState.updateMany).mockResolvedValue({ count: 0 } as never);
  vi.mocked(db.auditLog.create).mockResolvedValue({} as never);
  // Default: firstPaidAt flips (count 1 = this is the first payment).
  vi.mocked(db.workspace.updateMany).mockResolvedValue({ count: 1 } as never);
  // Callback-form $transaction: run the callback with `db` as the tx client.
  vi.mocked(db.$transaction).mockImplementation(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (async (arg: any) => (typeof arg === "function" ? arg(db) : Promise.all(arg))) as never
  );
});

afterEach(() => {
  delete process.env.STRIPE_WEBHOOK_SECRET;
});

describe("invoice.payment_succeeded — first-payment gate", () => {
  it("first paid invoice: flips firstPaidAt, re-scans backfill, and audits", async () => {
    const res = await POST(webhookRequest(makePaymentSucceededEvent(600)));

    expect(res.status).toBe(200);
    // Null-guarded flip so only the first payment sets the date.
    expect(db.workspace.updateMany).toHaveBeenCalledWith({
      where: { id: WS_ID, firstPaidAt: null },
      data: { firstPaidAt: expect.any(Date) },
    });
    expect(db.providerSyncState.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { emailAccount: { workspaceId: WS_ID } },
        data: expect.objectContaining({ backfillStatus: "PENDING" }),
      })
    );
    expect(db.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventType: "billing.first_payment" }),
      })
    );
  });

  it("redelivered webhook (already paid): flips 0 rows, skips re-scan and audit", async () => {
    vi.mocked(db.workspace.updateMany).mockResolvedValue({ count: 0 } as never);

    const res = await POST(webhookRequest(makePaymentSucceededEvent(600)));

    expect(res.status).toBe(200);
    expect(db.workspace.updateMany).toHaveBeenCalledOnce();
    expect(db.providerSyncState.updateMany).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it("trial-start $0 invoice (amount_paid === 0): no flip, no re-scan", async () => {
    const res = await POST(webhookRequest(makePaymentSucceededEvent(0)));

    expect(res.status).toBe(200);
    expect(db.workspace.updateMany).not.toHaveBeenCalled();
    expect(db.providerSyncState.updateMany).not.toHaveBeenCalled();
  });

  it("no workspace for the subscription: no-op", async () => {
    vi.mocked(db.workspace.findFirst).mockResolvedValue(null as never);

    const res = await POST(webhookRequest(makePaymentSucceededEvent(600)));

    expect(res.status).toBe(200);
    expect(db.workspace.update).not.toHaveBeenCalled();
    expect(db.workspace.updateMany).not.toHaveBeenCalled();
  });
});
