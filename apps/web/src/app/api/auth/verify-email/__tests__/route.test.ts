import { vi, describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Prisma known-request error stub (settable code) so tests can drive the P2025
// catch path without the real @prisma/client runtime. Hoisted for the factory.
const { PrismaClientKnownRequestError } = vi.hoisted(() => {
  class PrismaClientKnownRequestError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
    }
  }
  return { PrismaClientKnownRequestError };
});

vi.mock("@/auth", () => ({ auth: vi.fn(), unstable_update: vi.fn() }));
vi.mock("@amarnai/db", () => {
  const db: Record<string, unknown> = {
    verificationToken: { findUnique: vi.fn(), delete: vi.fn() },
    user: { updateMany: vi.fn(), findUnique: vi.fn() },
    userCredential: { findUnique: vi.fn(), deleteMany: vi.fn() },
    refreshToken: { deleteMany: vi.fn() },
  };
  // Interactive transaction: run the callback against the same mocked client so
  // assertions on db.* observe the writes done inside the transaction.
  db.$transaction = vi.fn(async (arg: unknown) =>
    typeof arg === "function" ? (arg as (tx: unknown) => unknown)(db) : arg
  );
  return { db, Prisma: { PrismaClientKnownRequestError } };
});
vi.mock("@amarnai/auth", () => ({
  issuePasswordResetToken: vi.fn(async () => "reset-tok"),
}));
vi.mock("@/lib/workspace", () => ({
  getOrCreateDefaultWorkspace: vi.fn(async () => ({ id: "ws-1" })),
}));
vi.mock("@/lib/email", () => ({
  sendWelcomeEmail: vi.fn(async () => {}),
  sendPasswordResetEmail: vi.fn(async () => {}),
}));

import { auth, unstable_update } from "@/auth";
import { db } from "@amarnai/db";
import { issuePasswordResetToken } from "@amarnai/auth";
import { sendPasswordResetEmail } from "@/lib/email";
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
  // Pre-read (emailVerified) + welcome/set-password lookups (email/name) share this mock.
  vi.mocked(db.user.findUnique).mockResolvedValue({
    emailVerified: null, // unverified -> first verification
    email: "u@b.com",
    name: null,
  } as never);
  vi.mocked(db.userCredential.findUnique).mockResolvedValue({ id: "cred-1" } as never);
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
    // Reset token minted inside the transaction (tx passed as the 2nd arg).
    expect(issuePasswordResetToken).toHaveBeenCalledWith(USER_ID, expect.anything());
    // B3: the set-password link is also emailed, not only put in the redirect.
    expect(sendPasswordResetEmail).toHaveBeenCalledWith("u@b.com", "reset-tok");
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
    expect(issuePasswordResetToken).toHaveBeenCalledWith(USER_ID, expect.anything());
    // No credential was invalidated, so NO unsolicited "reset password" email is
    // sent — the user sets their first password via the redirect (token in URL).
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
    expect(location(res)).toContain("/reset-password");
    expect(location(res)).toContain("token=reset-tok");
  });

  it("routes the double-click loser to sign-in instead of 500ing (B4/K3, non-owner)", async () => {
    // A concurrent click already flipped emailVerified: this transaction's guarded
    // updateMany matches 0 rows, so it aborts and no reset token is issued here.
    vi.mocked(db.user.updateMany).mockResolvedValue({ count: 0 } as never);

    const res = await GET(makeReq());

    expect(issuePasswordResetToken).not.toHaveBeenCalled();
    expect(db.verificationToken.delete).not.toHaveBeenCalled();
    expect(location(res)).toContain("/sign-in");
    expect(location(res)).toContain("verified=1");
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

  it("tolerates a concurrent token consumption on the trusted path (P2025, no 500)", async () => {
    // Registering session re-clicks: the trusted path's token delete races another
    // click and throws P2025; the route swallows it and still redirects.
    vi.mocked(auth).mockResolvedValue({ user: { id: USER_ID } } as never);
    vi.mocked(db.verificationToken.delete).mockRejectedValue(
      new PrismaClientKnownRequestError("Record to delete does not exist", "P2025")
    );

    const res = await GET(makeReq());

    expect(unstable_update).toHaveBeenCalled();
    expect(location(res)).not.toContain("error");
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
