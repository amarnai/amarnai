import { vi, describe, it, expect, beforeEach } from "vitest";
import { createHash } from "crypto";

vi.mock("@amarnai/db", () => ({
  db: {
    refreshToken: {
      create: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

import { db } from "@amarnai/db";
import { issueRefreshToken, rotateRefreshToken, revokeRefreshToken } from "./refresh-token.js";

const sha256 = (raw: string) => createHash("sha256").update(raw).digest("hex");

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.refreshToken.create).mockResolvedValue({} as never);
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
  });

  it("detects reuse of an already-used token and revokes the whole family", async () => {
    vi.mocked(db.refreshToken.findUnique).mockResolvedValue({
      id: "rt-1",
      userId: "user-1",
      familyId: "fam-1",
      usedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    } as never);

    expect(await rotateRefreshToken("stolen")).toBeNull();
    expect(db.refreshToken.deleteMany).toHaveBeenCalledWith({ where: { familyId: "fam-1" } });
    expect(db.refreshToken.updateMany).not.toHaveBeenCalled();
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
