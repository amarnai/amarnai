import { vi, describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/auth", () => ({ auth: vi.fn(), unstable_update: vi.fn() }));
vi.mock("@amarnai/db", () => ({
  db: {
    verificationToken: { findUnique: vi.fn(), delete: vi.fn() },
    user: { updateMany: vi.fn(), findUnique: vi.fn() },
    userCredential: { findUnique: vi.fn(), deleteMany: vi.fn() },
    refreshToken: { deleteMany: vi.fn() },
    $transaction: vi.fn(async () => [{ count: 1 }]),
  },
}));
vi.mock("@amarnai/auth", () => ({
  issuePasswordResetToken: vi.fn(async () => "reset-tok"),
}));
vi.mock("@/lib/workspace", () => ({ getOrCreateDefaultWorkspace: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendWelcomeEmail: vi.fn(async () => {}) }));

import { auth, unstable_update } from "@/auth";
import { db } from "@amarnai/db";
import { issuePasswordResetToken } from "@amarnai/auth";
import { GET } from "../route";

const USER_ID = "user-1";
const TOKEN = "verif-tok";

const makeReq = (token: string | null = TOKEN) =>
  new NextRequest(
    `http://localhost:3000/api/auth/verify-email${token ? `?token=${token}` : ""}`
  );

const location = (res: Response) => res.headers.get("location") ?? "";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue(null as never);
  vi.mocked(db.verificationToken.findUnique).mockResolvedValue({
    userId: USER_ID,
    type: "EMAIL_VERIFICATION",
    expiresAt: new Date(Date.now() + 60_000),
  } as never);
  vi.mocked(db.user.updateMany).mockResolvedValue({ count: 1 } as never);
  // Pre-read (emailVerified) + welcome lookup (email/name) share this mock.
  vi.mocked(db.user.findUnique).mockResolvedValue({
    emailVerified: null, // unverified -> first verification
    email: "u@b.com",
    name: null,
  } as never);
  vi.mocked(db.userCredential.findUnique).mockResolvedValue({ id: "cred-1" } as never);
  vi.mocked(db.$transaction).mockResolvedValue([{ count: 1 }] as never);
});

describe("GET /api/auth/verify-email", () => {
  it("atomically verifies + invalidates a LEGACY credential and routes a non-owner to set-password", async () => {
    // A credential present at first verification is a legacy pre-verification
    // password we never vouched for: drop it + its sessions, then set-password.
    const res = await GET(makeReq());

    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: USER_ID, emailVerified: null },
        data: expect.objectContaining({ sessionEpoch: { increment: 1 } }),
      })
    );
    expect(db.refreshToken.deleteMany).toHaveBeenCalledWith({ where: { userId: USER_ID } });
    expect(db.userCredential.deleteMany).toHaveBeenCalledWith({ where: { userId: USER_ID } });
    expect(db.verificationToken.delete).toHaveBeenCalledWith({ where: { token: TOKEN } });
    expect(issuePasswordResetToken).toHaveBeenCalledWith(USER_ID);
    expect(location(res)).toContain("/reset-password");
    expect(location(res)).toContain("token=reset-tok");
    expect(unstable_update).not.toHaveBeenCalled();
  });

  it("verifies an email-first account (no credential yet) and routes it to set its first password", async () => {
    vi.mocked(db.userCredential.findUnique).mockResolvedValue(null as never);

    const res = await GET(makeReq());

    // Verified in a transaction, but nothing to invalidate: no epoch bump, no
    // session/credential deletes — the user simply sets their first password.
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.refreshToken.deleteMany).not.toHaveBeenCalled();
    expect(db.userCredential.deleteMany).not.toHaveBeenCalled();
    expect(issuePasswordResetToken).toHaveBeenCalledWith(USER_ID);
    expect(location(res)).toContain("/reset-password");
    expect(location(res)).toContain("token=reset-tok");
  });

  it("keeps the credential for the registering session (same browser)", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: USER_ID } } as never);

    const res = await GET(makeReq());

    // Trusted: no invalidation transaction, straight into the app.
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.refreshToken.deleteMany).not.toHaveBeenCalled();
    expect(db.userCredential.deleteMany).not.toHaveBeenCalled();
    expect(issuePasswordResetToken).not.toHaveBeenCalled();
    expect(unstable_update).toHaveBeenCalled();
    expect(location(res)).not.toContain("/reset-password");
    expect(location(res)).not.toContain("/sign-in");
  });

  it("does not invalidate on a re-click of an already-verified account", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({
      emailVerified: new Date(), // already verified -> not first
      email: "u@b.com",
      name: null,
    } as never);
    vi.mocked(db.user.updateMany).mockResolvedValue({ count: 0 } as never);

    const res = await GET(makeReq());

    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.userCredential.deleteMany).not.toHaveBeenCalled();
    expect(location(res)).toContain("/sign-in");
    expect(location(res)).toContain("verified=1");
  });

  it("rejects an invalid/expired token without any mutation", async () => {
    vi.mocked(db.verificationToken.findUnique).mockResolvedValue({
      userId: USER_ID,
      type: "EMAIL_VERIFICATION",
      expiresAt: new Date(Date.now() - 1),
    } as never);

    const res = await GET(makeReq());

    expect(db.user.updateMany).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.userCredential.deleteMany).not.toHaveBeenCalled();
    expect(location(res)).toContain("error=invalid_token");
  });
});
