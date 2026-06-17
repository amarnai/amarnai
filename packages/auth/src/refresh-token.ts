import { createHash, randomBytes } from "crypto";
import { db } from "@amarnai/db";

const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// The raw token is shown to the device once; only this hash is persisted, so a
// database leak cannot be replayed against the API.
function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export type IssuedRefreshToken = { token: string; expiresAt: Date };

// Issues a refresh token. A fresh login starts a new family; a rotation passes
// the parent's familyId so the whole lineage can be revoked together if a stolen
// token is ever replayed.
export async function issueRefreshToken(
  userId: string,
  familyId?: string
): Promise<IssuedRefreshToken> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
  await db.refreshToken.create({
    data: {
      userId,
      familyId: familyId ?? randomBytes(16).toString("hex"),
      tokenHash: hashToken(token),
      expiresAt,
    },
  });
  return { token, expiresAt };
}

// Validates and rotates a refresh token. Returns the user id and a fresh child
// token, or null if the token is unknown, expired, or lost a concurrent race.
//
// Reuse detection: a token presented after it was already rotated (usedAt set)
// means the legitimate client has moved on to the child token, so a second use
// of the parent indicates theft. The entire family is revoked, forcing re-auth.
export async function rotateRefreshToken(
  raw: string
): Promise<{ userId: string; refresh: IssuedRefreshToken } | null> {
  const existing = await db.refreshToken.findUnique({
    where: { tokenHash: hashToken(raw) },
  });
  if (!existing) return null;

  if (existing.usedAt) {
    // Replay of an already-consumed token: revoke the whole lineage.
    await db.refreshToken.deleteMany({ where: { familyId: existing.familyId } });
    return null;
  }

  if (existing.expiresAt.getTime() < Date.now()) return null;

  // Atomic single-use: only the caller that flips usedAt from null wins. A
  // concurrent double-use loses (count 0) and is rejected without revoking the
  // family, since a legitimate race is not an attack.
  const consumed = await db.refreshToken.updateMany({
    where: { id: existing.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (consumed.count !== 1) return null;

  const refresh = await issueRefreshToken(existing.userId, existing.familyId);
  return { userId: existing.userId, refresh };
}

// Sign-out: revokes the entire family the presented token belongs to, so neither
// it nor its rotated descendants remain valid.
export async function revokeRefreshToken(raw: string): Promise<void> {
  const existing = await db.refreshToken.findUnique({
    where: { tokenHash: hashToken(raw) },
    select: { familyId: true },
  });
  if (existing) {
    await db.refreshToken.deleteMany({ where: { familyId: existing.familyId } });
  }
}
