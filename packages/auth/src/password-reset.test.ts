import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@amarnai/db", () => ({
  db: {
    user: { findUnique: vi.fn() },
    verificationToken: { deleteMany: vi.fn(), create: vi.fn() },
  },
}));

import { db } from "@amarnai/db";
import { createPasswordResetToken } from "./password-reset.js";

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
    expect(db.verificationToken.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1", type: "PASSWORD_RESET" },
    });
    const createArg = vi.mocked(db.verificationToken.create).mock.calls[0]![0] as {
      data: { userId: string; token: string; type: string; expiresAt: Date };
    };
    expect(createArg.data).toMatchObject({
      userId: "user-1",
      token,
      type: "PASSWORD_RESET",
    });
    expect(createArg.data.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("returns null (no token) for an unknown email", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(null);

    const token = await createPasswordResetToken("missing@b.com");

    expect(token).toBeNull();
    expect(db.verificationToken.create).not.toHaveBeenCalled();
  });

  it("returns null for a Google-only account (no credential)", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "user-1",
      credential: null,
      verificationTokens: [],
    } as never);

    const token = await createPasswordResetToken("g@b.com");

    expect(token).toBeNull();
    expect(db.verificationToken.create).not.toHaveBeenCalled();
  });

  it("returns null when a reset token was issued within the throttle window", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(
      credentialedUser([{ createdAt: new Date(Date.now() - 10_000) }]) as never
    );

    const token = await createPasswordResetToken("a@b.com");

    expect(token).toBeNull();
    expect(db.verificationToken.deleteMany).not.toHaveBeenCalled();
    expect(db.verificationToken.create).not.toHaveBeenCalled();
  });

  it("issues a token once the throttle window has passed", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(
      credentialedUser([{ createdAt: new Date(Date.now() - 120_000) }]) as never
    );

    const token = await createPasswordResetToken("a@b.com");

    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(db.verificationToken.create).toHaveBeenCalledTimes(1);
  });
});
