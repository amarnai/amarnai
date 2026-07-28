import { vi, describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockStripe = vi.hoisted(() => ({
  checkout: { sessions: { retrieve: vi.fn() } },
}));

vi.mock("@/lib/session", () => ({ getSessionUser: vi.fn() }));
vi.mock("@/lib/stripe", () => ({ getStripe: () => mockStripe }));

import { getSessionUser } from "@/lib/session";
import { GET } from "@/app/(app)/upgrade/resume/route";

const USER_ID = "user-1";

const makeReq = (query: string) =>
  new NextRequest(`http://test/upgrade/resume${query}`, { method: "GET" });

const location = (res: Response) => res.headers.get("location") ?? "";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSessionUser).mockResolvedValue({
    id: USER_ID,
    email: "a@b.com",
    name: null,
    image: null,
  } as never);
});

describe("GET /upgrade/resume", () => {
  it("forwards to the Stripe checkout URL for the session's owner", async () => {
    mockStripe.checkout.sessions.retrieve.mockResolvedValue({
      client_reference_id: USER_ID,
      status: "open",
      url: "https://checkout.stripe.test/c/pay/cs_1",
    });

    const res = await GET(makeReq("?session_id=cs_1"));

    expect(location(res)).toBe("https://checkout.stripe.test/c/pay/cs_1");
  });

  it("sends a signed-out visitor to sign in rather than to Stripe", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null as never);

    const res = await GET(makeReq("?session_id=cs_1"));

    expect(location(res)).toContain("/sign-in");
    expect(mockStripe.checkout.sessions.retrieve).not.toHaveBeenCalled();
  });

  it("refuses a checkout that belongs to somebody else", async () => {
    mockStripe.checkout.sessions.retrieve.mockResolvedValue({
      client_reference_id: "other-user",
      status: "open",
      url: "https://checkout.stripe.test/c/pay/cs_1",
    });

    const res = await GET(makeReq("?session_id=cs_1"));

    expect(location(res)).toContain("/upgrade");
    expect(location(res)).not.toContain("stripe.test");
  });

  it("sends an already-paid session to the page that provisions it", async () => {
    mockStripe.checkout.sessions.retrieve.mockResolvedValue({
      client_reference_id: USER_ID,
      status: "complete",
      url: "https://checkout.stripe.test/c/pay/cs_1",
    });

    const res = await GET(makeReq("?session_id=cs_1"));

    expect(location(res)).toContain("/upgrade/success?session_id=cs_1");
  });

  it("falls back to the upgrade page for an expired session", async () => {
    mockStripe.checkout.sessions.retrieve.mockResolvedValue({
      client_reference_id: USER_ID,
      status: "expired",
      url: "https://checkout.stripe.test/c/pay/cs_1",
    });

    expect(location(await GET(makeReq("?session_id=cs_1")))).toContain("/upgrade");
  });

  it("falls back when Stripe cannot find the session", async () => {
    mockStripe.checkout.sessions.retrieve.mockRejectedValue(new Error("No such session"));

    expect(location(await GET(makeReq("?session_id=cs_nope")))).toContain("/upgrade");
  });

  it("falls back when no session id is given", async () => {
    expect(location(await GET(makeReq("")))).toContain("/upgrade");
    expect(mockStripe.checkout.sessions.retrieve).not.toHaveBeenCalled();
  });
});
