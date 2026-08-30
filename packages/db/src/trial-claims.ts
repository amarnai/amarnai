import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { normalizeInboxKey } from "@aziru/shared";
import { db } from "./client.js";

// The single free trial is tracked by a reset-immune TrialClaim keyed on the
// email identity (and optionally the payment card). This module is the only place
// that reads/writes eligibility, so the "one trial per identity" rule lives in one
// spot. See the TrialClaim model comment for why it survives account deletion.
//
// NOTE: claims are keyed on the email at provisioning time. Amarnai has no
// change-email feature today; if one is ever added, this keying must be revisited
// (a user could otherwise consume a second trial by changing their address).

/**
 * The durable trial identity key: sha256 of the normalized email. We store the
 * hash, never the raw email, so a deleted account leaves only a pseudonymous
 * token behind. normalizeInboxKey collapses "+tag" aliases on every provider (and
 * dots on Gmail), so ben+x@outlook.com maps to the same claim as ben@outlook.com,
 * and b.en@gmail.com maps to ben@gmail.com, so one identity cannot farm two trials.
 */
export function trialEmailKeyHash(email: string): string {
  return crypto.createHash("sha256").update(normalizeInboxKey(email)).digest("hex");
}

/** True when this email identity has ever consumed a trial (survives deletion). */
export async function hasTrialClaim(email: string): Promise<boolean> {
  const existing = await db.trialClaim.findUnique({
    where: { emailKeyHash: trialEmailKeyHash(email) },
    select: { id: true },
  });
  return existing !== null;
}

/**
 * Whether the user has consumed their trial: the denormalized `trialUsed` flag OR
 * a durable claim on their email. Used to drive UI trial messaging. Null-safe: a
 * missing user is treated as not-consumed.
 */
export async function hasConsumedTrial(userId: string): Promise<boolean> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { trialUsed: true, email: true },
  });
  if (!user) return false;
  if (user.trialUsed) return true;
  return hasTrialClaim(user.email);
}

export type TrialClaimResult =
  | { granted: true }
  | { granted: false; reason: "email_claimed" | "card_claimed" };

/**
 * Atomically claim the one free trial for an email identity + card. The insert's
 * unique constraints (emailKeyHash, cardFingerprint) are the enforcement point, so
 * concurrent provisions cannot both succeed. Idempotent for the SAME subscription:
 * a re-provision (webhook + success-page/confirm-checkout racing, or a Stripe
 * redelivery) re-finds its own claim and is granted again rather than denied.
 */
export async function claimTrial(params: {
  email: string;
  userId: string;
  stripeSubscriptionId: string;
  cardFingerprint: string | null;
}): Promise<TrialClaimResult> {
  const emailKeyHash = trialEmailKeyHash(params.email);
  try {
    await db.trialClaim.create({
      data: {
        emailKeyHash,
        cardFingerprint: params.cardFingerprint,
        stripeSubscriptionId: params.stripeSubscriptionId,
        userId: params.userId,
      },
    });
    return { granted: true };
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") {
      throw err;
    }

    // A unique constraint blocked the insert. Re-read both keys to decide whether
    // this is our own subscription re-provisioning (idempotent → granted) or a
    // genuine second attempt by the same email/card (→ denied).
    const byEmail = await db.trialClaim.findUnique({ where: { emailKeyHash } });
    if (byEmail) {
      if (byEmail.stripeSubscriptionId === params.stripeSubscriptionId) return { granted: true };
      return { granted: false, reason: "email_claimed" };
    }

    if (params.cardFingerprint) {
      const byCard = await db.trialClaim.findUnique({
        where: { cardFingerprint: params.cardFingerprint },
      });
      if (byCard?.stripeSubscriptionId === params.stripeSubscriptionId) return { granted: true };
    }
    return { granted: false, reason: "card_claimed" };
  }
}

/**
 * Defensive write of a claim keyed on email hash only (no card/subscription).
 * Used at account-deletion time so a consumed trial survives even in the unlikely
 * case provisioning never recorded it. Upsert with an empty update never clobbers
 * an existing claim's cardFingerprint/subscriptionId.
 */
export async function ensureTrialClaimForEmail(params: {
  email: string;
  userId?: string;
}): Promise<void> {
  const emailKeyHash = trialEmailKeyHash(params.email);
  await db.trialClaim.upsert({
    where: { emailKeyHash },
    create: { emailKeyHash, userId: params.userId ?? null },
    update: {},
  });
}
