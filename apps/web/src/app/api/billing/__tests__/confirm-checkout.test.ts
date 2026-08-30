import { vi, describe, it, expect, beforeEach } from "vitest";

const mockStripe = vi.hoisted(() => ({
  checkout: { sessions: { retrieve: vi.fn() } },
}));

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@aziru/auth", () => ({ verifyAccessToken: vi.fn() }));
vi.mock("@aziru/db", () => ({
  db: { user: { findUnique: vi.fn() } },
}));
vi.mock("@/lib/stripe", () => ({ getStripe: () => mockStripe }));
vi.mock("@/lib/billing-provision", () => ({ provisionFromCheckoutSession: vi.fn() }));

import { auth } from "@/auth";
import { verifyAccessToken } from "@aziru/auth";
import { db } from "@aziru/db";
import { provisionFromCheckoutSession } from "@/lib/billing-provision";
import { POST } from "@/app/api/billing/confirm-checkout/route";

const USER_ID = "user-1";

const makeReq = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  new Request("http://test/api/billing/confirm-checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ user: { id: USER_ID } } as never);
  vi.mocked(db.user.findUnique).mockResolvedValue({ emailVerified: new Date(), sessionEpoch: 0 } as never);
});

describe("confirm-checkout", () => {
  it("provisions when the session is complete and belongs to the caller", async () => {
    mockStripe.checkout.sessions.retrieve.mockResolvedValue({
      client_reference_id: USER_ID,
      status: "complete",
    } as never);
    vi.mocked(provisionFromCheckoutSession).mockResolvedValue({ workspaceId: "ws-1", plan: "PRO" } as never);

    const res = await POST(makeReq({ sessionId: "cs_test_1" }));
    const body = (await res.json()) as { provisioned: boolean; plan: string; workspaceId: string };

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ provisioned: true, plan: "PRO", workspaceId: "ws-1" });
    expect(provisionFromCheckoutSession).toHaveBeenCalledOnce();
  });

  it("returns pending (not provisioned) when the session is not complete", async () => {
    mockStripe.checkout.sessions.retrieve.mockResolvedValue({
      client_reference_id: USER_ID,
      status: "open",
    } as never);

    const res = await POST(makeReq({ sessionId: "cs_test_1" }));
    const body = (await res.json()) as { pending: boolean };

    expect(res.status).toBe(200);
    expect(body.pending).toBe(true);
    expect(provisionFromCheckoutSession).not.toHaveBeenCalled();
  });

  it("returns 403 when the session belongs to another user", async () => {
    mockStripe.checkout.sessions.retrieve.mockResolvedValue({
      client_reference_id: "someone-else",
      status: "complete",
    } as never);

    const res = await POST(makeReq({ sessionId: "cs_test_1" }));
    expect(res.status).toBe(403);
    expect(provisionFromCheckoutSession).not.toHaveBeenCalled();
  });

  it("returns 404 when the session can't be retrieved", async () => {
    mockStripe.checkout.sessions.retrieve.mockRejectedValue(new Error("No such session"));
    const res = await POST(makeReq({ sessionId: "cs_missing" }));
    expect(res.status).toBe(404);
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    const res = await POST(makeReq({ sessionId: "cs_test_1" }));
    expect(res.status).toBe(401);
  });

  it("authenticates a native client via Bearer JWT", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    vi.mocked(verifyAccessToken).mockResolvedValue({ userId: USER_ID, sessionEpoch: 0 } as never);
    mockStripe.checkout.sessions.retrieve.mockResolvedValue({
      client_reference_id: USER_ID,
      status: "complete",
    } as never);
    vi.mocked(provisionFromCheckoutSession).mockResolvedValue({ workspaceId: "ws-1", plan: "PRO" } as never);

    const res = await POST(makeReq({ sessionId: "cs_test_1" }, { Authorization: "Bearer tok" }));
    expect(res.status).toBe(200);
    expect(verifyAccessToken).toHaveBeenCalledWith("tok");
  });
});

describe("credential precedence — an explicit token beats an ambient cookie", () => {
  it("acts as the Bearer's user even when a web session for someone else exists", async () => {
    // The panel calls these routes with its own token from a browser that may
    // hold a session for a different account. Letting the cookie win refused
    // requests the caller was entitled to make (and could have charged the
    // wrong workspace).
    vi.mocked(auth).mockResolvedValue({ user: { id: "someone-else" } } as never);
    vi.mocked(verifyAccessToken).mockResolvedValue({
      userId: USER_ID,
      sessionEpoch: 0,
    } as never);
    mockStripe.checkout.sessions.retrieve.mockResolvedValue({
      client_reference_id: USER_ID,
      status: "complete",
    });
    vi.mocked(provisionFromCheckoutSession).mockResolvedValue({
      workspaceId: "ws-1",
      plan: "PRO",
    } as never);

    const res = await POST(makeReq({ sessionId: "cs_1" }, { Authorization: "Bearer tok" }));

    expect(res.status).toBe(200);
    expect(verifyAccessToken).toHaveBeenCalledWith("tok");
  });

  it("still falls back to the cookie when no token is presented", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: USER_ID } } as never);
    mockStripe.checkout.sessions.retrieve.mockResolvedValue({
      client_reference_id: USER_ID,
      status: "complete",
    });
    vi.mocked(provisionFromCheckoutSession).mockResolvedValue({
      workspaceId: "ws-1",
      plan: "PRO",
    } as never);

    const res = await POST(makeReq({ sessionId: "cs_1" }));

    expect(res.status).toBe(200);
  });
});

describe("session outcomes the client must tell apart", () => {
  it("reports an expired session as final, not as still-in-progress", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: USER_ID } } as never);
    mockStripe.checkout.sessions.retrieve.mockResolvedValue({
      client_reference_id: USER_ID,
      status: "expired",
    });

    const res = await POST(makeReq({ sessionId: "cs_1" }));

    // Stripe will never complete it, so a client told "pending" would retry a
    // dead id until its own timer gave up.
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ expired: true });
    expect(provisionFromCheckoutSession).not.toHaveBeenCalled();
  });

  it("still reports an unfinished session as pending", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: USER_ID } } as never);
    mockStripe.checkout.sessions.retrieve.mockResolvedValue({
      client_reference_id: USER_ID,
      status: "open",
    });

    const res = await POST(makeReq({ sessionId: "cs_1" }));

    expect(await res.json()).toEqual({ pending: true });
  });
});
