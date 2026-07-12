import { createHash, randomBytes } from "crypto";
import { db, Prisma } from "@amarnai/db";

const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// How long after a token is rotated a replay is still treated as a benign retry
// (the client lost the rotation response and re-sent the same token) rather than
// theft. A legitimate retry lands within seconds; an attacker replaying a stolen
// token almost always does so long after the real client has moved on. Past this
// window, any replay of an already-rotated token revokes the whole family.
const REUSE_GRACE_MS = 60 * 1000; // 60 seconds

// Accepts either the base client or an interactive-transaction client so a
// rotation can issue its child inside the same transaction. Mirrors the DbClient
// seam in @amarnai/db (usage-meter.ts).
type DbClient = typeof db | Prisma.TransactionClient;

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
  familyId?: string,
  client: DbClient = db
): Promise<IssuedRefreshToken & { id: string }> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
  const created = await client.refreshToken.create({
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
// token, or null if the token is unknown, expired, replayed, or lost a
// concurrent race.
//
// Reuse detection: a token presented after it was already rotated (usedAt set)
// is either a benign retry (the client lost the rotation response and re-sent the
// same token within seconds) or theft (an attacker replays a stolen token, in
// practice long after the real client has moved on). We tell them apart by time:
// a replay within REUSE_GRACE_MS is a retry and is rejected WITHOUT revoking,
// unless the chain has already forked (the child it minted was also used, which a
// retry never does). A replay after the grace window is treated as theft and
// revokes the whole family regardless of child state — this is what catches an
// attacker who rotates a stolen token first and then holds the live child while
// the real client's next (much later) refresh trips the alarm.
export async function rotateRefreshToken(
  raw: string
): Promise<{ userId: string; sessionEpoch: number; refresh: IssuedRefreshToken } | null> {
  const existing = await db.refreshToken.findUnique({
    where: { tokenHash: hashToken(raw) },
  });
  if (!existing) return null;

  if (existing.usedAt) {
    const elapsedMs = Date.now() - existing.usedAt.getTime();

    // Past the retry window: any replay of an already-rotated token is theft.
    // Revoke the lineage unconditionally — we no longer need fork evidence.
    if (elapsedMs > REUSE_GRACE_MS) {
      await db.refreshToken.deleteMany({ where: { familyId: existing.familyId } });
      return null;
    }

    // Within the window: a lost-response retry, unless the chain already forked
    // (child also consumed). Revoke only on a proven fork; otherwise reject
    // quietly so a legitimate retry does not log every device out.
    const child = existing.replacedById
      ? await db.refreshToken.findUnique({ where: { id: existing.replacedById } })
      : null;
    if (child?.usedAt) {
      await db.refreshToken.deleteMany({ where: { familyId: existing.familyId } });
    }
    return null;
  }

  if (existing.expiresAt.getTime() < Date.now()) return null;

  // Consume the parent, mint the child, and record replacedById as ONE atomic
  // transaction. This makes the child link impossible to lose (a lost link would
  // fail reuse detection open for that lineage) and keeps the whole rotation
  // consistent. Atomic single-use: only the caller that flips usedAt from null
  // (count 1) proceeds; a concurrent double-use loses (count 0) and is rejected
  // without revoking, since a legitimate race is not an attack.
  //
  // The account's session epoch is read in the SAME transaction and returned, so
  // the caller can mint an epoch-stamped access token WITHOUT a second post-
  // rotation DB read. That read used to live in the /auth/refresh handler; when it
  // failed (or returned null) it threw AFTER the parent was already consumed,
  // burning a token the client could never recover — so the mint moved in here.
  // A null user row (account deleted mid-rotation) returns null: the caller 401s
  // and the just-minted child is orphaned, which is correct for a gone account.
  try {
    return await db.$transaction(async (tx) => {
      const consumed = await tx.refreshToken.updateMany({
        where: { id: existing.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (consumed.count !== 1) return null;

      const user = await tx.user.findUnique({
        where: { id: existing.userId },
        select: { sessionEpoch: true },
      });
      if (!user) return null;

      const child = await issueRefreshToken(existing.userId, existing.familyId, tx);
      await tx.refreshToken.update({
        where: { id: existing.id },
        data: { replacedById: child.id },
      });
      return {
        userId: existing.userId,
        sessionEpoch: user.sessionEpoch,
        refresh: { token: child.token, expiresAt: child.expiresAt },
      };
    });
  } catch (err) {
    // A concurrent family revoke (logout, or theft detection on another replay)
    // can delete the parent mid-transaction, so the update throws P2025; a unique
    // collision throws P2002. Both mean this rotation lost a race — reject with
    // null (a 401 the client retries) instead of surfacing a 500.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      (err.code === "P2025" || err.code === "P2002")
    ) {
      return null;
    }
    throw err;
  }
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
