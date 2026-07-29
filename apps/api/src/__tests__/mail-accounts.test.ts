import { vi, describe, it, expect, beforeEach } from "vitest";
import { authed, TEST_USER_ID } from "./helpers.js";

// The one call every injected mail-client surface makes before it can do
// anything: which workspace owns the mailbox on screen. User-scoped, so it sits
// outside the workspace membership guard and has to enforce tenancy itself.

vi.mock("@amarnai/config", () => ({
  config: {
    redis: { url: "redis://localhost:6379" },
    billing: {},
    internalApiSecret: "dev-internal-secret",
    mail: { labelWritebackEnabled: false },
  },
}));

vi.mock("@amarnai/db", () => ({
  Prisma: {},
  db: {
    emailConnection: { findMany: vi.fn() },
  },
}));

vi.mock("@amarnai/mail", () => ({
  createMailProvider: () => ({}),
  providerHasWritebackScope: () => false,
}));

import app from "../app.js";
import { db } from "@amarnai/db";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.emailConnection.findMany).mockResolvedValue([
    {
      workspaceId: "ws-1",
      provider: "GMAIL",
      emailAddress: "Ada@Example.com",
      status: "ACTIVE",
      workspace: { name: "Ada's inbox" },
    },
    {
      workspaceId: "ws-2",
      provider: "OUTLOOK",
      emailAddress: "ada@contoso.com",
      status: "DISCONNECTED",
      workspace: { name: "Work" },
    },
  ] as never);
});

describe("GET /me/mail-accounts", () => {
  it("returns every connected mailbox with its workspace", async () => {
    const res = await app.request("/me/mail-accounts", authed());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      accounts: [
        {
          email: "ada@example.com",
          workspaceId: "ws-1",
          workspaceName: "Ada's inbox",
          provider: "GMAIL",
          status: "ACTIVE",
        },
        {
          email: "ada@contoso.com",
          workspaceId: "ws-2",
          workspaceName: "Work",
          provider: "OUTLOOK",
          status: "DISCONNECTED",
        },
      ],
    });
  });

  // Every caller compares a lowercased mailbox address, so normalizing here
  // means none of them has to remember to.
  it("lowercases addresses so callers can compare directly", async () => {
    const res = await app.request("/me/mail-accounts", authed());
    const body = (await res.json()) as { accounts: Array<{ email: string }> };
    expect(body.accounts[0]?.email).toBe("ada@example.com");
  });

  // The route is not under the workspace membership guard, so this filter IS
  // the tenancy boundary.
  it("scopes the query to workspaces the authenticated user belongs to", async () => {
    await app.request("/me/mail-accounts", authed());
    expect(vi.mocked(db.emailConnection.findMany).mock.calls[0]?.[0]).toMatchObject({
      where: { workspace: { members: { some: { userId: TEST_USER_ID } } } },
    });
  });

  it("401s a service-secret call that names no user", async () => {
    const res = await app.request("/me/mail-accounts", authed({}, null));
    expect(res.status).toBe(401);
    expect(db.emailConnection.findMany).not.toHaveBeenCalled();
  });

  it("returns an empty list when the user has no mailbox connected", async () => {
    vi.mocked(db.emailConnection.findMany).mockResolvedValue([] as never);
    const res = await app.request("/me/mail-accounts", authed());
    expect(await res.json()).toEqual({ accounts: [] });
  });
});
