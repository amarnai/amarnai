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

describe("middleware auth gating — Outlook add-in routes", () => {
  // A task pane cannot follow a redirect to /sign-in: it is a frame inside
  // Outlook with no cookie session, so the pane authenticates itself with a
  // bearer token and must be reached logged-out.
  it("lets a logged-out request reach the task pane", () => {
    expect(isPassThrough(mw(makeReq("/outlook-panel")))).toBe(true);
  });

  it("lets Outlook fetch the add-in manifest without a session", () => {
    expect(isPassThrough(mw(makeReq("/outlook-manifest.xml")))).toBe(true);
  });

  it("does not make lookalike paths public", () => {
    for (const path of ["/outlook-panels", "/outlook-panel/secret"]) {
      const res = mw(makeReq(path));
      expect(res.status).toBe(307);
      expect(location(res)).toContain("/sign-in");
    }
  });

  it("sets the pane's framing policy on the pane response", () => {
    vi.stubEnv("OUTLOOK_ADDIN_ENABLED", "true");
    const res = mw(makeReq("/outlook-panel"));
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("frame-ancestors https://outlook.office.com");
    vi.unstubAllEnvs();
  });
});

describe("middleware auth gating — extension sign-in bridge", () => {
  it("lets a logged-out user reach the bridge (it carries its own one-time code)", () => {
    const res = mw(makeReq("/auth/bridge"));

    expect(isPassThrough(res)).toBe(true);
  });

  it("lets a signed-in but unverified user reach the bridge without bouncing to verify-email", () => {
    const res = mw(makeReq("/auth/bridge", { id: "u-1", isEmailVerified: false }));

    expect(isPassThrough(res)).toBe(true);
  });

  it("does not open up sibling paths under /auth", () => {
    const res = mw(makeReq("/auth/bridge-admin"));

    expect(res.status).toBe(307);
    expect(location(res)).toContain("/sign-in");
  });
});
