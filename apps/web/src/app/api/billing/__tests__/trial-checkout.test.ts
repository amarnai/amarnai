import { vi, describe, it, expect, beforeEach } from "vitest";

const mockStripe = vi.hoisted(() => ({
  checkout: { sessions: { create: vi.fn() } },
  subscriptions: { retrieve: vi.fn(), update: vi.fn() },
}));

vi.mock("@/auth", () => ({ auth: vi.fn() }));

vi.mock("@amarnai/db", () => ({
  db: {
    user: { findUnique: vi.fn() },
    workspaceMember: { findUnique: vi.fn() },
    workspace: { findUnique: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn() },
  },
  hasTrialClaim: vi.fn(),
}));

vi.mock("@/lib/stripe", () => ({
  getStripe: () => mockStripe,
  getPriceId: vi.fn(),
}));

import { auth } from "@/auth";
import { db, hasTrialClaim } from "@amarnai/db";
import { getStripe, getPriceId } from "@/lib/stripe";
import { POST } from "@/app/api/billing/create-checkout-session/route";

const stripe = getStripe();

const USER_ID = "user-1";
const WS_ID = "ws-1";
const ALT_WS_ID = "ws-2";
const PRICE_ID = "price_test_pro_monthly";
const CHECKOUT_URL = "https://checkout.stripe.com/pay/cs_test_abc123";

function upgradeReq(workspaceId: string, plan = "pro", cycle = "monthly") {
  return new Request("http://localhost/api/billing/create-checkout-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plan, cycle, action: "upgrade", workspaceId }),
  });
}

function createReq(plan = "pro", cycle = "monthly", newWorkspaceName = "New Workspace") {
  return new Request("http://localhost/api/billing/create-checkout-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plan, cycle, action: "create", newWorkspaceName }),
  });
}

function sessionsCreateArg() {
  return vi.mocked(stripe.checkout.sessions.create).mock.calls[0]?.[0];
}

beforeEach(() => {
  vi.clearAllMocks();

  vi.mocked(auth).mockResolvedValue({ user: { id: USER_ID } } as never);
  vi.mocked(getPriceId).mockReturnValue(PRICE_ID);
  vi.mocked(stripe.checkout.sessions.create).mockResolvedValue({ url: CHECKOUT_URL } as never);

  // Default: fresh, email-verified user with no prior trial
  vi.mocked(db.user.findUnique).mockResolvedValue({
    trialUsed: false,
    email: "user@example.com",
    emailVerified: new Date(),
  } as never);

  // Default: no durable trial claim on this email identity
  vi.mocked(hasTrialClaim).mockResolvedValue(false);

  // Default: user is workspace OWNER
  vi.mocked(db.workspaceMember.findUnique).mockResolvedValue({ role: "OWNER" } as never);

  // Default: workspace on FREE plan with no active subscription
  vi.mocked(db.workspace.findUnique).mockResolvedValue({
    plan: "FREE",
    stripeSubscriptionId: null,
  } as never);
});

describe("trial eligibility — upgrade action (FREE → paid)", () => {
  it("offers a 14-day trial when user has never subscribed before", async () => {
    const res = await POST(upgradeReq(WS_ID));

    expect(res.status).toBe(200);
    expect(sessionsCreateArg()?.subscription_data).toMatchObject({ trial_period_days: 14 });
  });

  it("scenario 1a: after cancelling a trial on the same workspace, second checkout has no trial", async () => {
    // After cancellation the webhook sets user.trialUsed = true.
    // Simulate that state here: user already consumed their trial.
    vi.mocked(db.user.findUnique).mockResolvedValue({ trialUsed: true, emailVerified: new Date() } as never);

    const res = await POST(upgradeReq(WS_ID));

    expect(res.status).toBe(200);
    expect(sessionsCreateArg()?.subscription_data?.trial_period_days).toBeUndefined();
  });

  it("re-registered email: trialUsed is false on the new account but a durable claim suppresses the trial", async () => {
    // A user who consumed a trial, deleted their account, and signed up again gets
    // a fresh User row (trialUsed=false) — but the reset-immune claim on their email
    // still recognizes them.
    vi.mocked(db.user.findUnique).mockResolvedValue({
      trialUsed: false,
      email: "reused@example.com",
      emailVerified: new Date(),
    } as never);
    vi.mocked(hasTrialClaim).mockResolvedValue(true);

    const res = await POST(upgradeReq(WS_ID));

    expect(res.status).toBe(200);
    expect(sessionsCreateArg()?.subscription_data?.trial_period_days).toBeUndefined();
  });

  it("scenario 2: after cancelling a trial on workspace A, upgrading workspace B has no trial", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({ trialUsed: true, emailVerified: new Date() } as never);
    // Second workspace (still FREE, no subscription)
    vi.mocked(db.workspace.findUnique).mockResolvedValue({
      plan: "FREE",
      stripeSubscriptionId: null,
    } as never);

    const res = await POST(upgradeReq(ALT_WS_ID));

    expect(res.status).toBe(200);
    expect(sessionsCreateArg()?.subscription_data?.trial_period_days).toBeUndefined();
  });

  it("scenario 3a: after a Pro trial, trying Business on the same workspace has no trial", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({ trialUsed: true, emailVerified: new Date() } as never);
    vi.mocked(getPriceId).mockReturnValue("price_test_business_monthly");

    const res = await POST(upgradeReq(WS_ID, "business", "monthly"));

    expect(res.status).toBe(200);
    expect(sessionsCreateArg()?.subscription_data?.trial_period_days).toBeUndefined();
  });

  it("scenario 3b: after a Business trial, trying Pro annual has no trial", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({ trialUsed: true, emailVerified: new Date() } as never);
    vi.mocked(getPriceId).mockReturnValue("price_test_pro_annual");

    const res = await POST(upgradeReq(WS_ID, "pro", "annual"));

    expect(res.status).toBe(200);
    expect(sessionsCreateArg()?.subscription_data?.trial_period_days).toBeUndefined();
  });

  it("PRO → BUSINESS direct upgrade skips checkout and updates subscription in-place", async () => {
    const SUB_ID = "sub_existing_123";
    vi.mocked(db.workspace.findUnique).mockResolvedValue({
      plan: "PRO",
      stripeSubscriptionId: SUB_ID,
    } as never);
    vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue({
      items: { data: [{ id: "si_1", current_period_end: 9999999999 }] },
    } as never);
    vi.mocked(stripe.subscriptions.update).mockResolvedValue({
      items: { data: [{ id: "si_1", current_period_end: 9999999999 }] },
    } as never);

    const res = await POST(upgradeReq(WS_ID, "business", "monthly"));
    const body = await res.json() as { upgraded: boolean };

    expect(res.status).toBe(200);
    expect(body.upgraded).toBe(true);
    // No Stripe Checkout session created — subscription is updated directly
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("returns 403 when caller is not the workspace owner", async () => {
    vi.mocked(db.workspaceMember.findUnique).mockResolvedValue({ role: "MEMBER" } as never);

    const res = await POST(upgradeReq(WS_ID));

    expect(res.status).toBe(403);
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);

    const res = await POST(upgradeReq(WS_ID));

    expect(res.status).toBe(401);
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("returns 403 and never starts checkout when the account is unverified", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({
      trialUsed: false,
      emailVerified: null,
    } as never);

    const res = await POST(upgradeReq(WS_ID));

    expect(res.status).toBe(403);
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("returns 401 when the session points to a user that no longer exists", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(null);

    const res = await POST(upgradeReq(WS_ID));

    expect(res.status).toBe(401);
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });
});

describe("trial eligibility — create action (new workspace)", () => {
  it("offers a 14-day trial when user has never subscribed before", async () => {
    const res = await POST(createReq("pro", "monthly", "My New Workspace"));

    expect(res.status).toBe(200);
    expect(sessionsCreateArg()?.subscription_data).toMatchObject({ trial_period_days: 14 });
  });

  it("scenario 2b: after cancelling a trial on workspace A, creating workspace B has no trial", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({ trialUsed: true, emailVerified: new Date() } as never);

    const res = await POST(createReq("pro", "monthly", "Second Workspace"));

    expect(res.status).toBe(200);
    expect(sessionsCreateArg()?.subscription_data?.trial_period_days).toBeUndefined();
  });

  it("scenario 3c: after using a Pro trial, creating a new workspace for Business has no trial", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({ trialUsed: true, emailVerified: new Date() } as never);

    const res = await POST(createReq("business", "annual", "Business Workspace"));

    expect(res.status).toBe(200);
    expect(sessionsCreateArg()?.subscription_data?.trial_period_days).toBeUndefined();
  });

  it("returns 400 when newWorkspaceName is missing", async () => {
    const req = new Request("http://localhost/api/billing/create-checkout-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan: "pro", cycle: "monthly", action: "create" }),
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });
});
