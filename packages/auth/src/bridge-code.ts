import { createHash, randomBytes } from "crypto";
import { db, Prisma } from "@amarnai/db";

// The code lives only for the moment between a click in the side panel and the
// redirect it triggers. Anything longer is a replayable credential sitting in a
// URL (browser history, referrer logs) for no benefit.
const BRIDGE_CODE_TTL_MS = 90 * 1000; // 90 seconds

// The raw code is handed to the panel once; only this hash is persisted, so a
// database leak cannot be redeemed.
function hashCode(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export type IssuedBridgeCode = { code: string; expiresAt: Date };

export type RedeemedBridgeCode = {
  userId: string;
  email: string;
  emailVerified: boolean;
};

// Mints a one-time code for an already-authenticated user. Codes are not
// deduplicated per user: a double-click issues two, both single-use, both
// expiring in seconds.
export async function createBridgeCode(userId: string): Promise<IssuedBridgeCode> {
  const code = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + BRIDGE_CODE_TTL_MS);
  await db.authBridgeCode.create({
    data: { userId, codeHash: hashCode(code), expiresAt },
  });
  return { code, expiresAt };
}

// Resolves the account behind a code WITHOUT claiming it, so a caller can decide
// what to do before spending the single use. This exists for one case: the web
// bridge must not silently replace an existing session belonging to a different
// account, and it cannot compare accounts without first knowing whose code it is
// holding. Inspecting is not a sign-in on its own — only redeemBridgeCode mints
// anything — and it is reachable only by the same internal-secret caller.
export async function inspectBridgeCode(raw: string): Promise<RedeemedBridgeCode | null> {
  const existing = await db.authBridgeCode.findUnique({
    where: { codeHash: hashCode(raw) },
  });
  if (!existing) return null;
  if (existing.usedAt) return null;
  if (existing.expiresAt.getTime() < Date.now()) return null;

  const user = await db.user.findUnique({
    where: { id: existing.userId },
    select: { email: true, emailVerified: true },
  });
  if (!user) return null;

  return {
    userId: existing.userId,
    email: user.email,
    emailVerified: user.emailVerified !== null,
  };
}

// Claims a code and resolves the account behind it. Returns null for unknown,
// expired, already-used, and lost-race codes alike: the caller falls back to the
// normal sign-in page, so there is nothing to gain from telling them apart.
//
// The identity is read AFTER the atomic claim and returned to the caller, because
// the web server redeeming this code does not yet know who the user is (the API
// access token carries no email claim) and needs the email to detect that a
// different account is already signed in on the web.
export async function redeemBridgeCode(raw: string): Promise<RedeemedBridgeCode | null> {
  const codeHash = hashCode(raw);
  const existing = await db.authBridgeCode.findUnique({ where: { codeHash } });
  if (!existing) return null;
  if (existing.usedAt) return null;
  if (existing.expiresAt.getTime() < Date.now()) return null;

  try {
    return await db.$transaction(async (tx) => {
      // Atomic single-use: only the caller that flips usedAt from null (count 1)
      // proceeds. A concurrent second redemption of the same code loses and is
      // rejected, which is what makes a leaked URL worthless once it has been
      // followed.
      const claimed = await tx.authBridgeCode.updateMany({
        where: { id: existing.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (claimed.count !== 1) return null;

      const user = await tx.user.findUnique({
        where: { id: existing.userId },
        select: { email: true, emailVerified: true },
      });
      if (!user) return null;

      return {
        userId: existing.userId,
        email: user.email,
        emailVerified: user.emailVerified !== null,
      };
    });
  } catch (err) {
    // The row can be deleted mid-transaction when the account is removed
    // (onDelete: Cascade), which throws P2025. That means this redemption lost a
    // race with a gone account: reject with null instead of surfacing a 500.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      (err.code === "P2025" || err.code === "P2002")
    ) {
      return null;
    }
    throw err;
  }
}

// Deletes codes past their expiry. Run periodically alongside the refresh-token
// sweep so consumed and expired rows do not accumulate. Returns the count removed.
export async function deleteExpiredBridgeCodes(): Promise<number> {
  const { count } = await db.authBridgeCode.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return count;
}
