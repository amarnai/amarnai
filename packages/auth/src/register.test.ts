import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@amarnai/db", () => ({
  db: {
    user: { findUnique: vi.fn(), create: vi.fn() },
    userCredential: { update: vi.fn() },
    verificationToken: { deleteMany: vi.fn(), create: vi.fn() },
  },
}));

import { db } from "@amarnai/db";
import { registerWithPassword, rotateVerificationToken } from "./register.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("registerWithPassword", () => {
  it("creates a new account and issues a verification token", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(null);
    vi.mocked(db.user.create).mockResolvedValue({ id: "user-1" } as never);

    const result = await registerWithPassword({ email: "new@b.com", password: "password123" });

    expect(result).toEqual({
      status: "created",
      userId: "user-1",
      verificationToken: expect.any(String),
    });
    expect(db.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: "new@b.com",
          credential: { create: { passwordHash: expect.any(String) } },
        }),
      })
    );
    // The stored hash is bcrypt, never the raw password.
    const createArgs = vi.mocked(db.user.create).mock.calls[0]![0] as {
      data: { credential: { create: { passwordHash: string } } };
    };
    expect(createArgs.data.credential.create.passwordHash).not.toBe("password123");
    expect(db.verificationToken.create).toHaveBeenCalledTimes(1);
  });

  it("rejects a Google-only account (no password set)", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "user-1",
      emailVerified: new Date(),
      credential: null,
    } as never);

    const result = await registerWithPassword({ email: "g@b.com", password: "password123" });

    expect(result).toEqual({ status: "google_only" });
    expect(db.user.create).not.toHaveBeenCalled();
    expect(db.userCredential.update).not.toHaveBeenCalled();
  });

  it("reports an already-verified account as existing", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "user-1",
      emailVerified: new Date(),
      credential: { id: "cred-1" },
    } as never);

    const result = await registerWithPassword({ email: "v@b.com", password: "password123" });

    expect(result).toEqual({ status: "exists" });
    expect(db.userCredential.update).not.toHaveBeenCalled();
    expect(db.verificationToken.create).not.toHaveBeenCalled();
  });

  it("resets the password and re-issues verification for an unverified account", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "user-1",
      emailVerified: null,
      credential: { id: "cred-1" },
    } as never);

    const result = await registerWithPassword({ email: "u@b.com", password: "password123" });

    expect(result).toEqual({
      status: "resent",
      userId: "user-1",
      verificationToken: expect.any(String),
    });
    expect(db.userCredential.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user-1" } })
    );
    expect(db.user.create).not.toHaveBeenCalled();
    expect(db.verificationToken.create).toHaveBeenCalledTimes(1);
  });
});

describe("rotateVerificationToken", () => {
  it("clears outstanding tokens and creates a fresh 24h token", async () => {
    const token = await rotateVerificationToken("user-1");

    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(db.verificationToken.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1", type: "EMAIL_VERIFICATION" },
    });
    const createArg = vi.mocked(db.verificationToken.create).mock.calls[0]![0] as {
      data: { userId: string; token: string; type: string; expiresAt: Date };
    };
    expect(createArg.data).toMatchObject({
      userId: "user-1",
      token,
      type: "EMAIL_VERIFICATION",
    });
    expect(createArg.data.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});
