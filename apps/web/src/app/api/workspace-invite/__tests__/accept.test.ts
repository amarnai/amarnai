import { vi, describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@aziru/db", () => ({
  db: {
    workspaceInvitation: { findUnique: vi.fn(), delete: vi.fn() },
    user: { findFirst: vi.fn() },
    workspaceMember: { findUnique: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { auth } from "@/auth";
import { db } from "@aziru/db";
import { INVITE_COOKIE } from "@/lib/invite-redirect";
import { GET, POST } from "@/app/api/workspace-invite/accept/route";

const TOKEN = "tok-1";
const ACCEPT_PATH = `/api/workspace-invite/accept?token=${TOKEN}`;

const invitation = {
  id: "inv-1",
  workspaceId: "ws-1",
  invitedEmail: "invitee@example.com",
  expiresAt: new Date(Date.now() + 60_000),
  workspace: { id: "ws-1", name: "Pro Workspace", locale: "en" },
};

const makeReq = (token: string | null = TOKEN, method = "GET") =>
  new NextRequest(
    `http://localhost:3000/api/workspace-invite/accept${token ? `?token=${token}` : ""}`,
    { method },
  );

const location = (res: Response) => res.headers.get("location") ?? "";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue(null as never);
  vi.mocked(db.workspaceInvitation.findUnique).mockResolvedValue(invitation as never);
  vi.mocked(db.workspaceInvitation.delete).mockResolvedValue({} as never);
  vi.mocked(db.user.findFirst).mockResolvedValue(null as never);
  vi.mocked(db.workspaceMember.findUnique).mockResolvedValue(null as never);
  vi.mocked(db.workspaceMember.create).mockResolvedValue({} as never);
  vi.mocked(db.$transaction).mockResolvedValue([] as never);
});

describe("GET /api/workspace-invite/accept — validation", () => {
  it("redirects to invalid_invite when no token is present", async () => {
    const res = await GET(makeReq(null));

    expect(res.status).toBe(307);
    expect(location(res)).toContain("/sign-in?error=invalid_invite");
    expect(db.workspaceInvitation.findUnique).not.toHaveBeenCalled();
  });

  it("redirects to invalid_invite when the token is unknown", async () => {
    vi.mocked(db.workspaceInvitation.findUnique).mockResolvedValue(null as never);

    const res = await GET(makeReq());

    expect(location(res)).toContain("/sign-in?error=invalid_invite");
  });

  it("redirects to invalid_invite when the invitation has expired", async () => {
    vi.mocked(db.workspaceInvitation.findUnique).mockResolvedValue({
      ...invitation,
      expiresAt: new Date(Date.now() - 60_000),
    } as never);

    const res = await GET(makeReq());

    expect(location(res)).toContain("/sign-in?error=invalid_invite");
  });
});

describe("GET /api/workspace-invite/accept — logged out", () => {
  it("routes to sign-up with the email prefilled when no account exists", async () => {
    vi.mocked(db.user.findFirst).mockResolvedValue(null as never);

    const res = await GET(makeReq());

    expect(location(res)).toContain("/sign-up?invite=1&email=invitee%40example.com");
    expect(res.cookies.get(INVITE_COOKIE)?.value).toBe(ACCEPT_PATH);
  });

  it("routes to sign-in when an account already exists", async () => {
    vi.mocked(db.user.findFirst).mockResolvedValue({ id: "u-9" } as never);

    const res = await GET(makeReq());

    expect(location(res)).toContain("/sign-in?invite=1");
    expect(res.cookies.get(INVITE_COOKIE)?.value).toBe(ACCEPT_PATH);
  });
});

describe("GET /api/workspace-invite/accept — signed in", () => {
  it("blocks a wrong-account session and keeps the invite pending", async () => {
    vi.mocked(auth).mockResolvedValue({
      user: { id: "u-2", email: "someone.else@example.com" },
    } as never);

    const res = await GET(makeReq());

    expect(location(res)).toContain("/sign-in?error=invite_wrong_account");
    expect(location(res)).toContain("email=invitee%40example.com");
    expect(res.cookies.get(INVITE_COOKIE)?.value).toBe(ACCEPT_PATH);
    expect(db.workspaceMember.create).not.toHaveBeenCalled();
  });

  it("creates the membership and consumes the invite on a matching account", async () => {
    vi.mocked(auth).mockResolvedValue({
      user: { id: "u-1", email: "invitee@example.com" },
    } as never);

    const res = await GET(makeReq());

    expect(db.workspaceMember.create).toHaveBeenCalledWith({
      data: { workspaceId: "ws-1", userId: "u-1", role: "MEMBER" },
    });
    expect(db.$transaction).toHaveBeenCalledOnce();
    expect(location(res)).toContain("/emails?joined_workspace=Pro%20Workspace");
    expect(res.cookies.get("amarnai-workspace")?.value).toBe("ws-1");
    // The pending-invite cookie is cleared on success.
    expect(res.cookies.get(INVITE_COOKIE)?.value).toBe("");
  });

  it("matches the invited email case-insensitively", async () => {
    vi.mocked(auth).mockResolvedValue({
      user: { id: "u-1", email: "INVITEE@Example.com" },
    } as never);

    const res = await GET(makeReq());

    expect(db.workspaceMember.create).toHaveBeenCalledOnce();
    expect(location(res)).toContain("/emails?joined_workspace=");
  });

  it("is idempotent: an existing member just clears the stale invitation", async () => {
    vi.mocked(auth).mockResolvedValue({
      user: { id: "u-1", email: "invitee@example.com" },
    } as never);
    vi.mocked(db.workspaceMember.findUnique).mockResolvedValue({ id: "m-1" } as never);

    const res = await GET(makeReq());

    expect(db.workspaceMember.create).not.toHaveBeenCalled();
    expect(db.workspaceInvitation.delete).toHaveBeenCalledWith({ where: { id: "inv-1" } });
    expect(location(res)).toContain("/emails?joined_workspace=Pro%20Workspace");
  });
});

// The post-sign-in server action redirects to this route to resume a pending
// invite, and the Next.js action client follows that redirect with a POST.
describe("POST /api/workspace-invite/accept — resumed after sign-in", () => {
  it("accepts the invite exactly like GET", async () => {
    vi.mocked(auth).mockResolvedValue({
      user: { id: "u-1", email: "invitee@example.com" },
    } as never);

    const res = await POST(makeReq(TOKEN, "POST"));

    expect(db.workspaceMember.create).toHaveBeenCalledWith({
      data: { workspaceId: "ws-1", userId: "u-1", role: "MEMBER" },
    });
    expect(location(res)).toContain("/emails?joined_workspace=Pro%20Workspace");
    expect(res.cookies.get(INVITE_COOKIE)?.value).toBe("");
  });

  it("still blocks a wrong-account session", async () => {
    vi.mocked(auth).mockResolvedValue({
      user: { id: "u-2", email: "someone.else@example.com" },
    } as never);

    const res = await POST(makeReq(TOKEN, "POST"));

    expect(location(res)).toContain("/sign-in?error=invite_wrong_account");
    expect(db.workspaceMember.create).not.toHaveBeenCalled();
  });
});
