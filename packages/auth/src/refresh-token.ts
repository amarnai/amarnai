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
// token is ever replayed. Also returns the new row's id so a rotating parent can
// record the child it minted (see rotateRefreshToken).
export async function issueRefreshToken(
  userId: string,
  familyId?: string
): Promise<IssuedRefreshToken & { id: string }> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
  const created = await db.refreshToken.create({
    data: {
      userId,
      familyId: familyId ?? randomBytes(16).toString("hex"),
      tokenHash: hashToken(token),
      expiresAt,
    },
  });
  return { id: created.id, token, expiresAt };
}

// Validates and rotates a refresh token. Returns the user id and a fresh child
// token, or null if the token is unknown, expired, or lost a concurrent race.
//
// Reuse detection: a token presented after it was already rotated (usedAt set)
// is either a benign retry (the client lost the rotation response and re-sent the
// same token, never advancing to the child) or theft (an attacker replayed a
// stolen token while the legitimate client also rotated). The two are told apart
// by the child: a real attack forks the chain so the child is ALSO used, whereas
// a retry leaves the child untouched. Only a used child revokes the family; a
// benign retry is rejected without logging every device out.
export async function rotateRefreshToken(
  raw: string
): Promise<{ userId: string; refresh: IssuedRefreshToken } | null> {
  const existing = await db.refreshToken.findUnique({
    where: { tokenHash: hashToken(raw) },
  });
  if (!existing) return null;

  if (existing.usedAt) {
    // Parent already rotated. Revoke the lineage only if the chain forked: the
    // child it minted was also consumed, which a benign retry never does. If the
    // child is still unused (or the link is missing), treat it as a lost-response
    // retry and reject without revoking.
    const child = existing.replacedById
      ? await db.refreshToken.findUnique({ where: { id: existing.replacedById } })
      : null;
    if (child?.usedAt) {
      await db.refreshToken.deleteMany({ where: { familyId: existing.familyId } });
    }
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
  // Record the child so a later replay of this now-used parent can distinguish a
  // benign retry from a fork. Best-effort: if this write is lost, reuse detection
  // simply fails safe (no revoke) rather than logging the user out on a retry.
  await db.refreshToken.update({
    where: { id: existing.id },
    data: { replacedById: refresh.id },
  });
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

// Revokes every refresh token a user holds, across all families and devices.
// Used on password reset so a stolen password cannot keep alive sessions the
// real owner does not control (ASVS: a password change terminates other active
// sessions). Short-lived web access JWTs are stateless and lapse on their own.
export async function revokeAllRefreshTokensForUser(userId: string): Promise<void> {
  await db.refreshToken.deleteMany({ where: { userId } });
}

// Deletes refresh tokens past their expiry. Run periodically (a daily worker
// job) so consumed and expired rows do not accumulate. Returns the count removed.
export async function deleteExpiredRefreshTokens(): Promise<number> {
  const { count } = await db.refreshToken.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return count;
}
