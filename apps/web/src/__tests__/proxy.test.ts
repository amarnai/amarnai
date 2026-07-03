import { describe, it, expect, vi } from "vitest";

// `auth` wraps the middleware handler; make it the identity so the default
// export is the raw handler we can call directly with a fake request.
vi.mock("@/auth", () => ({ auth: (handler: unknown) => handler }));

import middleware from "@/proxy";

type FakeUser = { id: string; isEmailVerified: boolean };

const mw = middleware as unknown as (req: unknown) => Response;

function makeReq(pathname: string, user: FakeUser | null = null): unknown {
  return {
    nextUrl: { pathname },
    url: `http://localhost:3000${pathname}`,
    auth: user ? { user } : null,
    cookies: { get: () => undefined },
    headers: new Headers(),
  };
}

const location = (res: Response) => res.headers.get("location") ?? "";
const isPassThrough = (res: Response) => res.headers.get("location") === null;

describe("middleware auth gating — invite accept route", () => {
  it("lets a logged-out user reach the invite-accept route (not bounced to sign-in)", () => {
    const res = mw(makeReq("/api/workspace-invite/accept"));

    expect(isPassThrough(res)).toBe(true);
  });

  it("still bounces a logged-out user off a normal protected page", () => {
    const res = mw(makeReq("/emails"));

    expect(res.status).toBe(307);
    expect(location(res)).toContain("/sign-in");
  });

  it("gates a signed-in but unverified user on the invite-accept route to verify-email", () => {
    const res = mw(makeReq("/api/workspace-invite/accept", { id: "u-1", isEmailVerified: false }));

    expect(res.status).toBe(307);
    expect(location(res)).toContain("/verify-email");
  });

  it("lets a signed-in verified user reach the invite-accept route", () => {
    const res = mw(makeReq("/api/workspace-invite/accept", { id: "u-1", isEmailVerified: true }));

    expect(isPassThrough(res)).toBe(true);
  });
});
