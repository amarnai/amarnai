import { createHash, randomBytes } from "crypto";
import { db } from "@amarnai/db";

const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// The raw token is shown to the device once; only this hash is persisted, so a
// database leak cannot be replayed against the API.
function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export type IssuedRefreshToken = { token: string; expiresAt: Date };

export async function issueRefreshToken(userId: string): Promise<IssuedRefreshToken> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
  await db.refreshToken.create({
    data: { userId, tokenHash: hashToken(token), expiresAt },
  });
  return { token, expiresAt };
}

// Validates and rotates a refresh token: the presented token is single-use and
// is always deleted, and a fresh token is issued on success. Returns the user id
// and the new token, or null if the token is unknown or expired.
export async function rotateRefreshToken(
  raw: string
): Promise<{ userId: string; refresh: IssuedRefreshToken } | null> {
  const existing = await db.refreshToken.findUnique({
    where: { tokenHash: hashToken(raw) },
  });
  if (!existing) return null;

  // Single-use: consume the presented token regardless of expiry.
  await db.refreshToken.delete({ where: { id: existing.id } }).catch(() => undefined);

  if (existing.expiresAt.getTime() < Date.now()) return null;

  const refresh = await issueRefreshToken(existing.userId);
  return { userId: existing.userId, refresh };
}

export async function revokeRefreshToken(raw: string): Promise<void> {
  await db.refreshToken.deleteMany({ where: { tokenHash: hashToken(raw) } });
}
