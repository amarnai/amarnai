import { vi, describe, it, expect, beforeEach } from "vitest";
import { createHash } from "crypto";

vi.mock("@amarnai/db", () => ({
  db: {
    refreshToken: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

import { db } from "@amarnai/db";
import {
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  deleteExpiredRefreshTokens,
} from "./refresh-token.js";

const sha256 = (raw: string) => createHash("sha256").update(raw).digest("hex");

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.refreshToken.create).mockResolvedValue({ id: "rt-child" } as never);
  vi.mocked(db.refreshToken.update).mockResolvedValue({} as never);
  vi.mocked(db.refreshToken.updateMany).mockResolvedValue({ count: 1 } as never);
  vi.mocked(db.refreshToken.deleteMany).mockResolvedValue({ count: 1 } as never);
});

describe("issueRefreshToken", () => {
  it("stores only the hash and starts a new family by default", async () => {
    const { token, expiresAt } = await issueRefreshToken("user-1");

    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    const arg = vi.mocked(db.refreshToken.create).mock.calls[0]![0].data;
    expect(arg).toMatchObject({ userId: "user-1", tokenHash: sha256(token) });
    expect(arg.familyId).toMatch(/^[0-9a-f]{32}$/); // generated family id
  });

  it("reuses the given family id on rotation", async () => {
    await issueRefreshToken("user-1", "fam-1");
    expect(vi.mocked(db.refreshToken.create).mock.calls[0]![0].data).toMatchObject({
      familyId: "fam-1",
    });
  });
});

describe("rotateRefreshToken", () => {
  it("returns null for an unknown token", async () => {
    vi.mocked(db.refreshToken.findUnique).mockResolvedValue(null);
    expect(await rotateRefreshToken("nope")).toBeNull();
    expect(db.refreshToken.updateMany).not.toHaveBeenCalled();
    expect(db.refreshToken.deleteMany).not.toHaveBeenCalled();
  });

  it("consumes a valid token and issues a fresh one in the same family", async () => {
    vi.mocked(db.refreshToken.findUnique).mockResolvedValue({
      id: "rt-1",
      userId: "user-1",
      familyId: "fam-1",
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    } as never);

    const result = await rotateRefreshToken("raw-token");

    expect(result?.userId).toBe("user-1");
    expect(result?.refresh.token).toMatch(/^[0-9a-f]{64}$/);
    // Atomic consume guarded on usedAt: null.
    expect(db.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { id: "rt-1", usedAt: null },
      data: { usedAt: expect.any(Date) },
    });
    // Child issued in the parent's family.
    expect(vi.mocked(db.refreshToken.create).mock.calls[0]![0].data).toMatchObject({
      familyId: "fam-1",
    });
    // Parent records the child it minted so a later replay can be classified.
    expect(db.refreshToken.update).toHaveBeenCalledWith({
      where: { id: "rt-1" },
      data: { replacedById: "rt-child" },
    });
  });

  it("revokes the whole family when a used parent's child was also used (fork = theft)", async () => {
    vi.mocked(db.refreshToken.findUnique)
      .mockResolvedValueOnce({
        id: "rt-1",
        userId: "user-1",
        familyId: "fam-1",
        usedAt: new Date(),
        replacedById: "rt-2",
        expiresAt: new Date(Date.now() + 60_000),
      } as never)
      // The child was also consumed: the chain forked, so this is real theft.
      .mockResolvedValueOnce({ id: "rt-2", usedAt: new Date() } as never);

    expect(await rotateRefreshToken("stolen")).toBeNull();
    expect(db.refreshToken.deleteMany).toHaveBeenCalledWith({ where: { familyId: "fam-1" } });
    expect(db.refreshToken.updateMany).not.toHaveBeenCalled();
    expect(db.refreshToken.create).not.toHaveBeenCalled();
  });

  it("does NOT revoke on a benign retry: used parent whose child is still unused", async () => {
    vi.mocked(db.refreshToken.findUnique)
      .mockResolvedValueOnce({
        id: "rt-1",
        userId: "user-1",
        familyId: "fam-1",
        usedAt: new Date(),
        replacedById: "rt-2",
        expiresAt: new Date(Date.now() + 60_000),
      } as never)
      // The client lost the rotation response and never advanced: child unused.
      .mockResolvedValueOnce({ id: "rt-2", usedAt: null } as never);

    expect(await rotateRefreshToken("lost-response-retry")).toBeNull();
    expect(db.refreshToken.deleteMany).not.toHaveBeenCalled();
    expect(db.refreshToken.create).not.toHaveBeenCalled();
  });

  it("does NOT revoke when a used parent has no recorded child (legacy/link lost)", async () => {
    vi.mocked(db.refreshToken.findUnique).mockResolvedValue({
      id: "rt-1",
      userId: "user-1",
      familyId: "fam-1",
      usedAt: new Date(),
      replacedById: null,
      expiresAt: new Date(Date.now() + 60_000),
    } as never);

    expect(await rotateRefreshToken("legacy")).toBeNull();
    // Fails safe toward the user: no child link means no fork evidence.
    expect(db.refreshToken.deleteMany).not.toHaveBeenCalled();
    expect(db.refreshToken.create).not.toHaveBeenCalled();
  });

  it("rejects an expired token without issuing or revoking", async () => {
    vi.mocked(db.refreshToken.findUnique).mockResolvedValue({
      id: "rt-1",
      userId: "user-1",
      familyId: "fam-1",
      usedAt: null,
      expiresAt: new Date(Date.now() - 60_000),
    } as never);

    expect(await rotateRefreshToken("stale")).toBeNull();
    expect(db.refreshToken.updateMany).not.toHaveBeenCalled();
    expect(db.refreshToken.deleteMany).not.toHaveBeenCalled();
    expect(db.refreshToken.create).not.toHaveBeenCalled();
  });

  it("rejects when it loses the consume race (no family revocation)", async () => {
    vi.mocked(db.refreshToken.findUnique).mockResolvedValue({
      id: "rt-1",
      userId: "user-1",
      familyId: "fam-1",
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    } as never);
    vi.mocked(db.refreshToken.updateMany).mockResolvedValue({ count: 0 } as never);

    expect(await rotateRefreshToken("raced")).toBeNull();
    expect(db.refreshToken.create).not.toHaveBeenCalled();
    expect(db.refreshToken.deleteMany).not.toHaveBeenCalled();
  });
});

describe("revokeRefreshToken", () => {
  it("revokes the whole family on logout", async () => {
    vi.mocked(db.refreshToken.findUnique).mockResolvedValue({ familyId: "fam-1" } as never);
    await revokeRefreshToken("raw-token");
    expect(db.refreshToken.deleteMany).toHaveBeenCalledWith({ where: { familyId: "fam-1" } });
  });

  it("is a no-op for an unknown token", async () => {
    vi.mocked(db.refreshToken.findUnique).mockResolvedValue(null);
    await revokeRefreshToken("nope");
    expect(db.refreshToken.deleteMany).not.toHaveBeenCalled();
  });
});

describe("deleteExpiredRefreshTokens", () => {
  it("deletes rows past their expiry and returns the count", async () => {
    vi.mocked(db.refreshToken.deleteMany).mockResolvedValue({ count: 3 } as never);
    const removed = await deleteExpiredRefreshTokens();
    expect(removed).toBe(3);
    expect(db.refreshToken.deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lt: expect.any(Date) } },
    });
  });
});
