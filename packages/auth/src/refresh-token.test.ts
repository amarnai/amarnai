import { vi, describe, it, expect, beforeEach } from "vitest";
import { createHash } from "node:crypto";

vi.mock("@amarnai/db", () => ({
  db: {
    refreshToken: {
      create: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
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
  vi.mocked(db.refreshToken.delete).mockResolvedValue({} as never);
  vi.mocked(db.refreshToken.deleteMany).mockResolvedValue({ count: 1 } as never);
});

describe("issueRefreshToken", () => {
  it("stores only the hash of the token and returns the raw token", async () => {
    const { token, expiresAt } = await issueRefreshToken("user-1");

    expect(token).toMatch(/^[0-9a-f]{64}$/); // 32 random bytes, hex
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(db.refreshToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: "user-1", tokenHash: sha256(token) }),
    });
  });
});

describe("rotateRefreshToken", () => {
  it("returns null and issues nothing for an unknown token", async () => {
    vi.mocked(db.refreshToken.findUnique).mockResolvedValue(null);
    expect(await rotateRefreshToken("nope")).toBeNull();
    expect(db.refreshToken.delete).not.toHaveBeenCalled();
    expect(db.refreshToken.create).not.toHaveBeenCalled();
  });

  it("consumes a valid token and issues a fresh one", async () => {
    vi.mocked(db.refreshToken.findUnique).mockResolvedValue({
      id: "rt-1",
      userId: "user-1",
      expiresAt: new Date(Date.now() + 60_000),
    } as never);

    const result = await rotateRefreshToken("raw-token");

    expect(result?.userId).toBe("user-1");
    expect(result?.refresh.token).toMatch(/^[0-9a-f]{64}$/);
    expect(db.refreshToken.delete).toHaveBeenCalledWith({ where: { id: "rt-1" } });
    expect(db.refreshToken.create).toHaveBeenCalledTimes(1); // the replacement
  });

  it("consumes but does not renew an expired token", async () => {
    vi.mocked(db.refreshToken.findUnique).mockResolvedValue({
      id: "rt-2",
      userId: "user-1",
      expiresAt: new Date(Date.now() - 60_000),
    } as never);

    expect(await rotateRefreshToken("stale")).toBeNull();
    expect(db.refreshToken.delete).toHaveBeenCalledWith({ where: { id: "rt-2" } });
    expect(db.refreshToken.create).not.toHaveBeenCalled();
  });
});

describe("revokeRefreshToken", () => {
  it("deletes by token hash", async () => {
    await revokeRefreshToken("raw-token");
    expect(db.refreshToken.deleteMany).toHaveBeenCalledWith({
      where: { tokenHash: sha256("raw-token") },
    });
  });
});
