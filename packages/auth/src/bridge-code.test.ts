import { vi, describe, it, expect, beforeEach } from "vitest";
import { createHash } from "crypto";

// A Prisma known-request error stub with a settable `code`, so tests can drive
// the P2025/P2002 catch path without pulling in the real @prisma/client runtime.
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

vi.mock("@amarnai/db", () => {
  const authBridgeCode = {
    create: vi.fn(),
    findUnique: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  };
  // redeemBridgeCode resolves the account inside its transaction so the web
  // server learns the email it needs for the wrong-account check.
  const user = { findUnique: vi.fn() };
  return {
    db: {
      authBridgeCode,
      user,
      $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb({ authBridgeCode, user })),
    },
    Prisma: { PrismaClientKnownRequestError },
  };
});

import { db } from "@amarnai/db";
import { createBridgeCode, redeemBridgeCode, deleteExpiredBridgeCodes } from "./bridge-code.js";

const sha256 = (raw: string) => createHash("sha256").update(raw).digest("hex");

const future = () => new Date(Date.now() + 60_000);
const past = () => new Date(Date.now() - 1_000);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.authBridgeCode.create).mockResolvedValue({ id: "bc-1" } as never);
  vi.mocked(db.authBridgeCode.updateMany).mockResolvedValue({ count: 1 } as never);
  vi.mocked(db.authBridgeCode.deleteMany).mockResolvedValue({ count: 0 } as never);
  vi.mocked(db.user.findUnique).mockResolvedValue({
    email: "user@example.com",
    emailVerified: new Date(),
  } as never);
});

describe("createBridgeCode", () => {
  it("persists only the hash of the returned code", async () => {
    const { code, expiresAt } = await createBridgeCode("user-1");

    expect(code).toMatch(/^[0-9a-f]{64}$/);
    const data = vi.mocked(db.authBridgeCode.create).mock.calls[0]![0]!.data as {
      userId: string;
      codeHash: string;
    };
    expect(data.userId).toBe("user-1");
    expect(data.codeHash).toBe(sha256(code));
    expect(data.codeHash).not.toBe(code);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("issues distinct codes for repeated calls", async () => {
    const first = await createBridgeCode("user-1");
    const second = await createBridgeCode("user-1");
    expect(first.code).not.toBe(second.code);
  });
});

describe("redeemBridgeCode", () => {
  it("claims a live code and resolves the account", async () => {
    vi.mocked(db.authBridgeCode.findUnique).mockResolvedValue({
      id: "bc-1",
      userId: "user-1",
      usedAt: null,
      expiresAt: future(),
    } as never);

    const result = await redeemBridgeCode("raw-code");

    expect(result).toEqual({
      userId: "user-1",
      email: "user@example.com",
      emailVerified: true,
    });
    expect(db.authBridgeCode.findUnique).toHaveBeenCalledWith({
      where: { codeHash: sha256("raw-code") },
    });
    // The claim must be conditional on usedAt still being null.
    expect(db.authBridgeCode.updateMany).toHaveBeenCalledWith({
      where: { id: "bc-1", usedAt: null },
      data: { usedAt: expect.any(Date) },
    });
  });

  it("reports an unverified account rather than failing", async () => {
    vi.mocked(db.authBridgeCode.findUnique).mockResolvedValue({
      id: "bc-1",
      userId: "user-1",
      usedAt: null,
      expiresAt: future(),
    } as never);
    vi.mocked(db.user.findUnique).mockResolvedValue({
      email: "user@example.com",
      emailVerified: null,
    } as never);

    expect(await redeemBridgeCode("raw-code")).toEqual({
      userId: "user-1",
      email: "user@example.com",
      emailVerified: false,
    });
  });

  it("rejects an unknown code without touching the claim", async () => {
    vi.mocked(db.authBridgeCode.findUnique).mockResolvedValue(null as never);

    expect(await redeemBridgeCode("raw-code")).toBeNull();
    expect(db.authBridgeCode.updateMany).not.toHaveBeenCalled();
  });

  it("rejects an already-used code", async () => {
    vi.mocked(db.authBridgeCode.findUnique).mockResolvedValue({
      id: "bc-1",
      userId: "user-1",
      usedAt: new Date(),
      expiresAt: future(),
    } as never);

    expect(await redeemBridgeCode("raw-code")).toBeNull();
    expect(db.authBridgeCode.updateMany).not.toHaveBeenCalled();
  });

  it("rejects an expired code", async () => {
    vi.mocked(db.authBridgeCode.findUnique).mockResolvedValue({
      id: "bc-1",
      userId: "user-1",
      usedAt: null,
      expiresAt: past(),
    } as never);

    expect(await redeemBridgeCode("raw-code")).toBeNull();
    expect(db.authBridgeCode.updateMany).not.toHaveBeenCalled();
  });

  it("rejects the loser of a concurrent redemption", async () => {
    vi.mocked(db.authBridgeCode.findUnique).mockResolvedValue({
      id: "bc-1",
      userId: "user-1",
      usedAt: null,
      expiresAt: future(),
    } as never);
    // Another request claimed the row between the read and the update.
    vi.mocked(db.authBridgeCode.updateMany).mockResolvedValue({ count: 0 } as never);

    expect(await redeemBridgeCode("raw-code")).toBeNull();
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });

  it("rejects when the account is gone", async () => {
    vi.mocked(db.authBridgeCode.findUnique).mockResolvedValue({
      id: "bc-1",
      userId: "user-1",
      usedAt: null,
      expiresAt: future(),
    } as never);
    vi.mocked(db.user.findUnique).mockResolvedValue(null as never);

    expect(await redeemBridgeCode("raw-code")).toBeNull();
  });

  it("returns null instead of throwing when the row is deleted mid-transaction", async () => {
    vi.mocked(db.authBridgeCode.findUnique).mockResolvedValue({
      id: "bc-1",
      userId: "user-1",
      usedAt: null,
      expiresAt: future(),
    } as never);
    vi.mocked(db.authBridgeCode.updateMany).mockRejectedValue(
      new PrismaClientKnownRequestError("row gone", "P2025") as never
    );

    expect(await redeemBridgeCode("raw-code")).toBeNull();
  });

  it("propagates unexpected database errors", async () => {
    vi.mocked(db.authBridgeCode.findUnique).mockResolvedValue({
      id: "bc-1",
      userId: "user-1",
      usedAt: null,
      expiresAt: future(),
    } as never);
    vi.mocked(db.authBridgeCode.updateMany).mockRejectedValue(new Error("connection lost"));

    await expect(redeemBridgeCode("raw-code")).rejects.toThrow("connection lost");
  });
});

describe("deleteExpiredBridgeCodes", () => {
  it("removes rows past their expiry and returns the count", async () => {
    vi.mocked(db.authBridgeCode.deleteMany).mockResolvedValue({ count: 3 } as never);

    expect(await deleteExpiredBridgeCodes()).toBe(3);
    expect(db.authBridgeCode.deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lt: expect.any(Date) } },
    });
  });
});
