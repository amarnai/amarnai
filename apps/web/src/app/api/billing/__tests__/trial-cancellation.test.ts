import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn() }));

vi.mock("@amarnai/db", () => ({
  db: {
    workspace: { findUnique: vi.fn(), update: vi.fn() },
    workspaceMember: { deleteMany: vi.fn() },
    user: { update: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/stripe", () => ({
  stripe: {
    subscriptions: { cancel: vi.fn(), update: vi.fn() },
  },
  getPriceId: vi.fn(),
}));

vi.mock("@/lib/workspace", () => ({
  getSelectedWorkspace: vi.fn(),
}));

import { auth } from "@/auth";
import { db } from "@amarnai/db";
import { stripe } from "@/lib/stripe";
import { getSelectedWorkspace } from "@/lib/workspace";
import { POST } from "@/app/api/billing/cancel-subscription/route";

const USER_ID = "user-1";
const WS_ID = "ws-1";
const SUB_ID = "sub_test_123";
const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
const PAST = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
const PERIOD_END_TS = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;

beforeEach(() => {
  vi.clearAllMocks();

  vi.mocked(auth).mockResolvedValue({ user: { id: USER_ID } } as never);
  vi.mocked(getSelectedWorkspace).mockResolvedValue({ id: WS_ID } as never);

  vi.mocked(db.$transaction).mockResolvedValue([] as never);
  vi.mocked(db.workspace.update).mockResolvedValue({} as never);
  vi.mocked(db.workspaceMember.deleteMany).mockResolvedValue({ count: 0 } as never);
  vi.mocked(db.user.update).mockResolvedValue({} as never);
  vi.mocked(stripe.subscriptions.cancel).mockResolvedValue({} as never);
  vi.mocked(stripe.subscriptions.update).mockResolvedValue({
    items: { data: [{ current_period_end: PERIOD_END_TS }] },
  } as never);
});

describe("cancel during active trial", () => {
  beforeEach(() => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({
      ownerUserId: USER_ID,
      stripeSubscriptionId: SUB_ID,
      trialEndsAt: FUTURE,
    } as never);
  });

  it("immediately cancels the Stripe subscription", async () => {
    await POST();

    expect(stripe.subscriptions.cancel).toHaveBeenCalledWith(SUB_ID);
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  it("returns immediateDowngrade: true", async () => {
    const res = await POST();
    const body = await res.json() as { immediateDowngrade: boolean };

    expect(res.status).toBe(200);
    expect(body.immediateDowngrade).toBe(true);
  });

  it("downgrades workspace to FREE and clears subscription fields", async () => {
    await POST();

    expect(db.workspace.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: WS_ID },
        data: expect.objectContaining({
          plan: "FREE",
          stripeSubscriptionId: null,
          stripePriceId: null,
          trialEndsAt: null,
        }),
      })
    );
  });

  it("never clears user.trialUsed — the trial is consumed even if cancelled early", async () => {
    await POST();

    // The workspace update must not include trialUsed so the flag on User is never reset
    const workspaceUpdateData = vi.mocked(db.workspace.update).mock.calls[0]?.[0]?.data;
    expect(workspaceUpdateData).not.toHaveProperty("trialUsed");

    // user.update is never called by the cancel route
    expect(db.user.update).not.toHaveBeenCalled();
  });
});

describe("cancel after trial period (paid phase)", () => {
  beforeEach(() => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({
      ownerUserId: USER_ID,
      stripeSubscriptionId: SUB_ID,
      trialEndsAt: PAST, // trial ended in the past — now in paid phase
    } as never);
  });

  it("schedules cancellation at period end instead of cancelling immediately", async () => {
    await POST();

    expect(stripe.subscriptions.update).toHaveBeenCalledWith(SUB_ID, {
      cancel_at_period_end: true,
    });
    expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
  });

  it("returns immediateDowngrade: false", async () => {
    const res = await POST();
    const body = await res.json() as { immediateDowngrade: boolean };

    expect(res.status).toBe(200);
    expect(body.immediateDowngrade).toBe(false);
  });

  it("sets cancelAtPeriodEnd on the workspace, does not touch user.trialUsed", async () => {
    await POST();

    expect(db.workspace.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ cancelAtPeriodEnd: true }),
      })
    );
    const workspaceUpdateData = vi.mocked(db.workspace.update).mock.calls[0]?.[0]?.data;
    expect(workspaceUpdateData).not.toHaveProperty("trialUsed");
    expect(db.user.update).not.toHaveBeenCalled();
  });
});

describe("cancel with no active trial date (null trialEndsAt)", () => {
  it("treats the subscription as past-trial and cancels at period end", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({
      ownerUserId: USER_ID,
      stripeSubscriptionId: SUB_ID,
      trialEndsAt: null,
    } as never);

    const res = await POST();
    const body = await res.json() as { immediateDowngrade: boolean };

    expect(res.status).toBe(200);
    expect(body.immediateDowngrade).toBe(false);
    expect(stripe.subscriptions.update).toHaveBeenCalledWith(SUB_ID, {
      cancel_at_period_end: true,
    });
  });
});

describe("access control", () => {
  it("returns 403 when caller is not the workspace owner", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({
      ownerUserId: "someone-else",
      stripeSubscriptionId: SUB_ID,
      trialEndsAt: FUTURE,
    } as never);

    const res = await POST();

    expect(res.status).toBe(403);
    expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  it("returns 404 when workspace has no active subscription", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({
      ownerUserId: USER_ID,
      stripeSubscriptionId: null,
      trialEndsAt: null,
    } as never);

    const res = await POST();

    expect(res.status).toBe(404);
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);

    const res = await POST();

    expect(res.status).toBe(401);
  });
});
