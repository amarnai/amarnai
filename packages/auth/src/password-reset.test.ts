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

vi.mock("@aziru/db", () => {
  const db: Record<string, unknown> = {
    user: { findUnique: vi.fn(), update: vi.fn() },
    userCredential: { upsert: vi.fn() },
    refreshToken: { deleteMany: vi.fn() },
    verificationToken: { deleteMany: vi.fn(), create: vi.fn(), upsert: vi.fn(), delete: vi.fn() },
  };
  db.$transaction = vi.fn(async (arg: unknown) =>
    typeof arg === "function" ? (arg as (tx: unknown) => unknown)(db) : arg
  );
  return { db, Prisma: { PrismaClientKnownRequestError } };
});

import { db } from "@aziru/db";
import { createPasswordResetToken, applyPasswordReset } from "./password-reset.js";

// A credentialed user with no outstanding reset token.
function credentialedUser(verificationTokens: { createdAt: Date }[] = []) {
  return {
    id: "user-1",
    credential: { id: "cred-1" },
    verificationTokens,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createPasswordResetToken", () => {
  it("issues a fresh 1h token for a credentialed account", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(credentialedUser() as never);

    const token = await createPasswordResetToken("a@b.com");

    expect(token).toMatch(/^[0-9a-f]{64}$/);
    const upsertArg = vi.mocked(db.verificationToken.upsert).mock.calls[0]![0] as {
      where: { userId_type: { userId: string; type: string } };
      create: { userId: string; token: string; type: string; expiresAt: Date };
    };
    expect(upsertArg.where).toEqual({
      userId_type: { userId: "user-1", type: "PASSWORD_RESET" },
    });
    expect(upsertArg.create).toMatchObject({
      userId: "user-1",
      token,
      type: "PASSWORD_RESET",
    });
    expect(upsertArg.create.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("returns null (no token) for an unknown email", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(null);

    const token = await createPasswordResetToken("missing@b.com");

    expect(token).toBeNull();
    expect(db.verificationToken.upsert).not.toHaveBeenCalled();
  });

  it("returns null for a Google-linked account with no password", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "user-1",
      emailVerified: new Date(),
      googleLinkedAt: new Date(),
      microsoftLinkedAt: null,
      credential: null,
      verificationTokens: [],
    } as never);

    const token = await createPasswordResetToken("g@b.com");

    expect(token).toBeNull();
    expect(db.verificationToken.upsert).not.toHaveBeenCalled();
  });

  it("returns null for a Microsoft-linked account with no password", async () => {
    // Without this the account would loop forever: it holds no password, so a
    // reset token would let a stranger set one on a mailbox they never proved.
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "user-1",
      emailVerified: new Date(),
      googleLinkedAt: null,
      microsoftLinkedAt: new Date(),
      credential: null,
      verificationTokens: [],
    } as never);

    const token = await createPasswordResetToken("m@b.com");

    expect(token).toBeNull();
    expect(db.verificationToken.upsert).not.toHaveBeenCalled();
  });

  it("returns null for an unverified account with no password (must verify first)", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "user-1",
      emailVerified: null,
      googleLinkedAt: null,
      microsoftLinkedAt: null,
      credential: null,
      verificationTokens: [],
    } as never);

    const token = await createPasswordResetToken("u@b.com");

    expect(token).toBeNull();
    expect(db.verificationToken.upsert).not.toHaveBeenCalled();
  });

  it("issues a set-password token for a verified passwordless non-federated account (B2/K1)", async () => {
    // Email-first user who verified but abandoned setting a password. This is
    // their durable recovery path — without it the account is stranded.
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "user-1",
      emailVerified: new Date(),
      googleLinkedAt: null,
      microsoftLinkedAt: null,
      credential: null,
      verificationTokens: [],
    } as never);

    const token = await createPasswordResetToken("stranded@b.com");

    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(db.verificationToken.upsert).toHaveBeenCalledTimes(1);
  });

  it("returns null when a reset token was issued within the throttle window", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(
      credentialedUser([{ createdAt: new Date(Date.now() - 10_000) }]) as never
    );

    const token = await createPasswordResetToken("a@b.com");

    expect(token).toBeNull();
    expect(db.verificationToken.deleteMany).not.toHaveBeenCalled();
    expect(db.verificationToken.upsert).not.toHaveBeenCalled();
  });

  it("issues a token once the throttle window has passed", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(
      credentialedUser([{ createdAt: new Date(Date.now() - 120_000) }]) as never
    );

    const token = await createPasswordResetToken("a@b.com");

    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(db.verificationToken.upsert).toHaveBeenCalledTimes(1);
  });
});

describe("applyPasswordReset", () => {
  it("consumes the token, sets the password, and revokes sessions in one transaction (C1/N7)", async () => {
    const result = await applyPasswordReset("user-1", "hash", "tok");

    expect(result).toBe("ok");
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    // Token consumed FIRST, then credential upserted, sessions revoked, epoch bumped.
    expect(db.verificationToken.delete).toHaveBeenCalledWith({ where: { token: "tok" } });
    expect(db.userCredential.upsert).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      create: { userId: "user-1", passwordHash: "hash" },
      update: { passwordHash: "hash" },
    });
    expect(db.refreshToken.deleteMany).toHaveBeenCalledWith({ where: { userId: "user-1" } });
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { sessionEpoch: { increment: 1 } },
    });
  });

  it("reports already_used on a double-submit (P2025) instead of throwing", async () => {
    vi.mocked(db.verificationToken.delete).mockRejectedValue(
      new PrismaClientKnownRequestError("Record to delete does not exist", "P2025")
    );

    const result = await applyPasswordReset("user-1", "hash", "tok");

    expect(result).toBe("already_used");
    // Token-first: the credential is never written when the token is already gone.
    expect(db.userCredential.upsert).not.toHaveBeenCalled();
  });

  it("rethrows an unexpected (non-P2025) error", async () => {
    // clearAllMocks() keeps implementations, so reset delete to succeed here.
    vi.mocked(db.verificationToken.delete).mockResolvedValue({} as never);
    vi.mocked(db.userCredential.upsert).mockRejectedValue(new Error("db down"));

    await expect(applyPasswordReset("user-1", "hash", "tok")).rejects.toThrow("db down");
  });
});
