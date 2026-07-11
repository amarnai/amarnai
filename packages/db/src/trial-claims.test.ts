import { vi, describe, it, expect, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("./client", () => ({
  db: {
    trialClaim: { create: vi.fn(), findUnique: vi.fn(), upsert: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));

import { db } from "./client";
import {
  trialEmailKeyHash,
  hasTrialClaim,
  hasConsumedTrial,
  claimTrial,
} from "./trial-claims";

const SUB_ID = "sub_123";

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("trialEmailKeyHash", () => {
  it("collapses gmail dot/plus aliases and case to one key", () => {
    expect(trialEmailKeyHash("Ben+promo@GMAIL.com")).toBe(trialEmailKeyHash("b.en@gmail.com"));
  });

  it("collapses +tag aliases to one key on non-gmail domains (Outlook honors +tag)", () => {
    expect(trialEmailKeyHash("user+1@outlook.com")).toBe(trialEmailKeyHash("user+2@outlook.com"));
    expect(trialEmailKeyHash("user+1@outlook.com")).toBe(trialEmailKeyHash("user@outlook.com"));
  });

  it("treats dots as significant on custom domains", () => {
    expect(trialEmailKeyHash("b.en@corp.com")).not.toBe(trialEmailKeyHash("ben@corp.com"));
  });
});

describe("hasTrialClaim", () => {
  it("is true when a claim exists for the email identity", async () => {
    vi.mocked(db.trialClaim.findUnique).mockResolvedValue({ id: "tc_1" } as never);
    expect(await hasTrialClaim("user@example.com")).toBe(true);
  });

  it("is false when no claim exists", async () => {
    vi.mocked(db.trialClaim.findUnique).mockResolvedValue(null);
    expect(await hasTrialClaim("user@example.com")).toBe(false);
  });
});

describe("hasConsumedTrial", () => {
  it("is true when the denormalized flag is set (without reading claims)", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({ trialUsed: true, email: "u@x.com" } as never);
    expect(await hasConsumedTrial("user-1")).toBe(true);
    expect(db.trialClaim.findUnique).not.toHaveBeenCalled();
  });

  it("is true when the flag is false but a durable claim exists", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({ trialUsed: false, email: "u@x.com" } as never);
    vi.mocked(db.trialClaim.findUnique).mockResolvedValue({ id: "tc_1" } as never);
    expect(await hasConsumedTrial("user-1")).toBe(true);
  });

  it("is false for a missing user", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(null);
    expect(await hasConsumedTrial("nobody")).toBe(false);
  });
});

describe("claimTrial", () => {
  const base = { email: "user@example.com", userId: "user-1", cardFingerprint: "fp_1" };

  it("grants when the atomic insert succeeds", async () => {
    vi.mocked(db.trialClaim.create).mockResolvedValue({ id: "tc_1" } as never);
    const result = await claimTrial({ ...base, stripeSubscriptionId: SUB_ID });
    expect(result).toEqual({ granted: true });
  });

  it("is idempotent: a P2002 whose existing email claim is the SAME subscription is granted", async () => {
    vi.mocked(db.trialClaim.create).mockRejectedValue(p2002());
    vi.mocked(db.trialClaim.findUnique).mockResolvedValue({ stripeSubscriptionId: SUB_ID } as never);
    const result = await claimTrial({ ...base, stripeSubscriptionId: SUB_ID });
    expect(result).toEqual({ granted: true });
  });

  it("denies (email_claimed) when the email already consumed a DIFFERENT subscription's trial", async () => {
    vi.mocked(db.trialClaim.create).mockRejectedValue(p2002());
    vi.mocked(db.trialClaim.findUnique).mockResolvedValue({ stripeSubscriptionId: "sub_other" } as never);
    const result = await claimTrial({ ...base, stripeSubscriptionId: SUB_ID });
    expect(result).toEqual({ granted: false, reason: "email_claimed" });
  });

  it("denies (card_claimed) when the collision is on the card, not the email", async () => {
    vi.mocked(db.trialClaim.create).mockRejectedValue(p2002());
    // No email claim, but the card was already used by another identity.
    vi.mocked(db.trialClaim.findUnique)
      .mockResolvedValueOnce(null) // by email
      .mockResolvedValueOnce({ stripeSubscriptionId: "sub_other" } as never); // by card
    const result = await claimTrial({ ...base, stripeSubscriptionId: SUB_ID });
    expect(result).toEqual({ granted: false, reason: "card_claimed" });
  });

  it("denies a second trial claimed via a +tag variant of an already-claimed address", async () => {
    // First identity claims the trial for user@outlook.com.
    vi.mocked(db.trialClaim.create).mockResolvedValueOnce({ id: "tc_1" } as never);
    const first = await claimTrial({
      email: "user@outlook.com",
      userId: "user-1",
      cardFingerprint: null,
      stripeSubscriptionId: SUB_ID,
    });
    expect(first).toEqual({ granted: true });
    // Both addresses collapse to one durable key, so the second insert targets the
    // same emailKeyHash the first already claimed.
    const sharedHash = trialEmailKeyHash("user@outlook.com");
    expect(db.trialClaim.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ data: expect.objectContaining({ emailKeyHash: sharedHash }) }),
    );

    // A farmer retries with user+2@outlook.com: same emailKeyHash, so the insert
    // collides (P2002) and the existing claim belongs to a DIFFERENT subscription.
    vi.mocked(db.trialClaim.create).mockRejectedValueOnce(p2002());
    vi.mocked(db.trialClaim.findUnique).mockResolvedValueOnce({ stripeSubscriptionId: SUB_ID } as never);
    const second = await claimTrial({
      email: "user+2@outlook.com",
      userId: "user-2",
      cardFingerprint: null,
      stripeSubscriptionId: "sub_farmed",
    });
    expect(second).toEqual({ granted: false, reason: "email_claimed" });
    // The +tag variant resolves to the same durable key it was blocked on.
    expect(db.trialClaim.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ data: expect.objectContaining({ emailKeyHash: sharedHash }) }),
    );
  });

  it("rethrows errors that are not unique-constraint violations", async () => {
    vi.mocked(db.trialClaim.create).mockRejectedValue(new Error("connection lost"));
    await expect(claimTrial({ ...base, stripeSubscriptionId: SUB_ID })).rejects.toThrow("connection lost");
  });
});
