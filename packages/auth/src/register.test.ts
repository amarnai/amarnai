import { vi, describe, it, expect, beforeEach } from "vitest";

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

vi.mock("@amarnai/db", () => ({
  db: {
    user: { findUnique: vi.fn(), create: vi.fn() },
    verificationToken: { deleteMany: vi.fn(), create: vi.fn(), upsert: vi.fn() },
  },
  Prisma: { PrismaClientKnownRequestError },
}));

import { db } from "@amarnai/db";
import { registerEmail, rotateVerificationToken } from "./register.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("registerEmail", () => {
  it("creates a brand-new account with NO credential and issues a verification token", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(null);
    vi.mocked(db.user.create).mockResolvedValue({ id: "user-1" } as never);

    const result = await registerEmail({ email: "new@b.com" });

    expect(result).toEqual({ status: "verify", verificationToken: expect.any(String) });
    // Email-first: the account row is created without a password credential.
    expect(db.user.create).toHaveBeenCalledWith({
      data: { email: "new@b.com" },
      select: { id: true },
    });
    const createArgs = vi.mocked(db.user.create).mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(createArgs.data).not.toHaveProperty("credential");
    expect(createArgs.data).not.toHaveProperty("password");
    expect(db.verificationToken.upsert).toHaveBeenCalledTimes(1);
  });

  it("reports an existing verified password account as already_registered (no email leak in status)", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "user-1",
      emailVerified: new Date(),
      credential: { id: "cred-1" },
      verificationTokens: [],
    } as never);

    const result = await registerEmail({ email: "v@b.com" });

    expect(result).toEqual({ status: "already_registered" });
    expect(db.user.create).not.toHaveBeenCalled();
    expect(db.verificationToken.upsert).not.toHaveBeenCalled();
  });

  it("reports an existing verified Google account as google_only", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "user-1",
      emailVerified: new Date(),
      googleLinkedAt: new Date(),
      credential: null,
      verificationTokens: [],
    } as never);

    const result = await registerEmail({ email: "g@b.com" });

    expect(result).toEqual({ status: "google_only" });
    expect(db.verificationToken.upsert).not.toHaveBeenCalled();
  });

  it("reports a verified passwordless NON-Google account as already_registered, not google_only (N8)", async () => {
    // Email-first account that verified but never set a password: it must not be
    // told to sign in with Google. already_registered routes it to the notice
    // email, whose forgot-password link issues a set-password token.
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "user-1",
      emailVerified: new Date(),
      googleLinkedAt: null,
      credential: null,
      verificationTokens: [],
    } as never);

    const result = await registerEmail({ email: "stranded@b.com" });

    expect(result).toEqual({ status: "already_registered" });
    expect(db.verificationToken.upsert).not.toHaveBeenCalled();
  });

  it("resends verification for an existing unverified account", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "user-1",
      emailVerified: null,
      credential: null,
      verificationTokens: [], // no recent resend, so not throttled
    } as never);

    const result = await registerEmail({ email: "u@b.com" });

    expect(result).toEqual({ status: "verify", verificationToken: expect.any(String) });
    expect(db.user.create).not.toHaveBeenCalled();
    expect(db.verificationToken.upsert).toHaveBeenCalledTimes(1);
  });

  it("throttles a rapid re-register of an unverified account (no email sent)", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "user-1",
      emailVerified: null,
      credential: null,
      verificationTokens: [{ createdAt: new Date() }],
    } as never);

    const result = await registerEmail({ email: "u@b.com" });

    expect(result).toEqual({ status: "verify", verificationToken: null });
    // Throttled: no new token issued, so no email is sent.
    expect(db.verificationToken.upsert).not.toHaveBeenCalled();
  });

  it("never stores a password (no bcrypt path) regardless of account state", async () => {
    // A password is never part of registration, so there is no per-state bcrypt
    // cost — the account-existence timing oracle is gone by construction.
    vi.mocked(db.user.findUnique).mockResolvedValue(null);
    vi.mocked(db.user.create).mockResolvedValue({ id: "user-1" } as never);

    await registerEmail({ email: "new@b.com" });

    // db has no userCredential in the mock at all; a hash/create would throw.
    expect(db.user.create).toHaveBeenCalledTimes(1);
  });

  it("returns the neutral verify response (no double email) on a concurrent create race (K4)", async () => {
    // Two concurrent registrations of the same new email both passed findUnique;
    // this one's create loses the unique-email constraint. It must not 500 and
    // must not re-issue a token (the winner already emailed one).
    vi.mocked(db.user.findUnique).mockResolvedValue(null);
    vi.mocked(db.user.create).mockRejectedValue(
      new PrismaClientKnownRequestError("unique email", "P2002") as never
    );

    const result = await registerEmail({ email: "race@b.com" });

    expect(result).toEqual({ status: "verify", verificationToken: null });
    expect(db.verificationToken.upsert).not.toHaveBeenCalled();
  });
});

describe("rotateVerificationToken", () => {
  it("upserts a fresh 24h token on the (userId, type) key", async () => {
    const token = await rotateVerificationToken("user-1");

    expect(token).toMatch(/^[0-9a-f]{64}$/);
    const upsertArg = vi.mocked(db.verificationToken.upsert).mock.calls[0]![0] as {
      where: { userId_type: { userId: string; type: string } };
      create: { userId: string; token: string; type: string; expiresAt: Date };
      update: { token: string; expiresAt: Date; createdAt: Date };
    };
    expect(upsertArg.where).toEqual({
      userId_type: { userId: "user-1", type: "EMAIL_VERIFICATION" },
    });
    expect(upsertArg.create).toMatchObject({
      userId: "user-1",
      token,
      type: "EMAIL_VERIFICATION",
    });
    expect(upsertArg.create.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});
