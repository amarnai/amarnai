import { vi, describe, it, expect, beforeEach } from "vitest";

const mockStripe = vi.hoisted(() => ({
  subscriptions: { retrieve: vi.fn(), update: vi.fn() },
}));

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@amarnai/auth", () => ({ verifyAccessToken: vi.fn() }));

vi.mock("@amarnai/db", () => ({
  db: {
    workspace: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    workspaceMember: { findMany: vi.fn() },
    user: { findUnique: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}));

vi.mock("@/lib/stripe", () => ({
  getStripe: () => mockStripe,
  getPriceId: vi.fn(),
}));

vi.mock("@/lib/workspace", () => ({
  getSelectedWorkspace: vi.fn(),
}));

import { auth } from "@/auth";
import { verifyAccessToken } from "@amarnai/auth";
import { db } from "@amarnai/db";
import { getStripe, getPriceId } from "@/lib/stripe";
import { getSelectedWorkspace } from "@/lib/workspace";
import { POST } from "@/app/api/billing/change-plan/route";

const stripe = getStripe();

const USER_ID = "user-1";
const WS_ID = "ws-1";
const SUB_ID = "sub_test_123";
const PERIOD_END_TS = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;

const makeReq = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  new Request("http://test/api/billing/change-plan", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();

  vi.mocked(auth).mockResolvedValue({ user: { id: USER_ID } } as never);
  vi.mocked(getSelectedWorkspace).mockResolvedValue({ id: WS_ID } as never);
  vi.mocked(db.user.findUnique).mockResolvedValue({ emailVerified: new Date(), sessionEpoch: 0 } as never);
  vi.mocked(db.workspace.update).mockResolvedValue({} as never);
  vi.mocked(db.workspaceMember.findMany).mockResolvedValue([] as never);
  vi.mocked(db.auditLog.create).mockResolvedValue({} as never);
  vi.mocked(getPriceId).mockReturnValue("price_pro_monthly");
  vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue({
    items: { data: [{ id: "si_1" }] },
  } as never);
  vi.mocked(stripe.subscriptions.update).mockResolvedValue({
    items: { data: [{ current_period_end: PERIOD_END_TS }] },
  } as never);
});

describe("downgrade Business -> Pro", () => {
  beforeEach(() => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({
      plan: "BUSINESS",
      ownerUserId: USER_ID,
      stripeSubscriptionId: SUB_ID,
      billingCycle: "MONTHLY",
    } as never);
  });

  it("updates the Stripe subscription with proration and persists the new plan", async () => {
    const res = await POST(makeReq({ plan: "pro", cycle: "monthly" }));
    const body = (await res.json()) as { changed: boolean };

    expect(res.status).toBe(200);
    expect(body.changed).toBe(true);
    expect(stripe.subscriptions.update).toHaveBeenCalledWith(SUB_ID, {
      items: [{ id: "si_1", price: "price_pro_monthly" }],
      proration_behavior: "create_prorations",
      cancel_at_period_end: false,
      automatic_tax: { enabled: true },
    });
    expect(db.workspace.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: WS_ID },
        data: expect.objectContaining({ plan: "PRO", billingCycle: "MONTHLY" }),
      }),
    );
  });

  it("blocks the downgrade when collaborators exceed the lower plan's limit", async () => {
    // Pro allows 10 collaborators; 11 is over the cap.
    vi.mocked(db.workspaceMember.findMany).mockResolvedValue(
      Array.from({ length: 11 }, (_, i) => ({
        user: { name: null, email: `c${i}@x.com` },
      })) as never,
    );

    const res = await POST(makeReq({ plan: "pro", cycle: "monthly" }));
    const body = (await res.json()) as { membersToRemove: unknown[] };

    expect(res.status).toBe(409);
    expect(body.membersToRemove).toHaveLength(11);
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(db.workspace.update).not.toHaveBeenCalled();
  });
});

describe("guards", () => {
  it("rejects an upgrade (Pro -> Business)", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({
      plan: "PRO",
      ownerUserId: USER_ID,
      stripeSubscriptionId: SUB_ID,
      billingCycle: "MONTHLY",
    } as never);

    const res = await POST(makeReq({ plan: "business", cycle: "monthly" }));
    expect(res.status).toBe(400);
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  it("returns 403 when caller is not the workspace owner", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({
      plan: "BUSINESS",
      ownerUserId: "someone-else",
      stripeSubscriptionId: SUB_ID,
      billingCycle: "MONTHLY",
    } as never);

    const res = await POST(makeReq({ plan: "pro", cycle: "monthly" }));
    expect(res.status).toBe(403);
  });

  it("returns 400 when the workspace has no active subscription", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({
      plan: "FREE",
      ownerUserId: USER_ID,
      stripeSubscriptionId: null,
      billingCycle: null,
    } as never);

    const res = await POST(makeReq({ plan: "pro", cycle: "monthly" }));
    expect(res.status).toBe(400);
  });
});

describe("auth", () => {
  it("returns 401 when unauthenticated (no cookie, no bearer)", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    const res = await POST(makeReq({ plan: "pro", cycle: "monthly" }));
    expect(res.status).toBe(401);
  });

  it("authenticates a native client via Bearer JWT", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    vi.mocked(verifyAccessToken).mockResolvedValue({ userId: USER_ID, sessionEpoch: 0 } as never);
    vi.mocked(db.workspace.findUnique).mockResolvedValue({
      plan: "BUSINESS",
      ownerUserId: USER_ID,
      stripeSubscriptionId: SUB_ID,
      billingCycle: "MONTHLY",
    } as never);

    const res = await POST(makeReq({ plan: "pro", cycle: "monthly" }, { Authorization: "Bearer tok" }));

    expect(res.status).toBe(200);
    expect(verifyAccessToken).toHaveBeenCalledWith("tok");
  });
});
