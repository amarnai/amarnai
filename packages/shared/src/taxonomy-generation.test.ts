import { describe, it, expect } from "vitest";
import {
  computeGenerationEligibility,
  generationDeltaThreshold,
  emailDomain,
  GENERATION_MIN_ELIGIBLE_THREADS,
  GENERATION_MIN_SENDER_DOMAINS,
  type GenerationEligibilityInput,
} from "./taxonomy-generation.js";

const NOW = new Date("2026-06-24T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function base(overrides: Partial<GenerationEligibilityInput> = {}): GenerationEligibilityInput {
  return {
    lastOutcome: null,
    lastGeneratedAt: null,
    threadCountAtLastGen: null,
    lastAttemptAt: null,
    currentEligibleCount: 500,
    currentSenderDomainCount: 40,
    generationsWindowStart: null,
    generationsInWindow: 0,
    plan: "FREE",
    now: NOW,
    ...overrides,
  };
}

describe("computeGenerationEligibility", () => {
  it("allows a first generation when the inbox is rich enough", () => {
    expect(computeGenerationEligibility(base())).toEqual({ eligible: true, reason: "OK" });
  });

  it("blocks when too few eligible threads", () => {
    const r = computeGenerationEligibility(
      base({ currentEligibleCount: GENERATION_MIN_ELIGIBLE_THREADS - 1 }),
    );
    expect(r).toEqual({ eligible: false, reason: "INBOX_TOO_SMALL" });
  });

  it("blocks when too few distinct sender domains", () => {
    const r = computeGenerationEligibility(
      base({ currentSenderDomainCount: GENERATION_MIN_SENDER_DOMAINS - 1 }),
    );
    expect(r).toEqual({ eligible: false, reason: "INBOX_TOO_SMALL" });
  });

  it("blocks regeneration until the inbox grows past the delta threshold", () => {
    const threshold = generationDeltaThreshold(500); // 500 + max(200, 125) = 700
    const blocked = computeGenerationEligibility(
      base({
        lastOutcome: "SUCCESS",
        lastGeneratedAt: new Date(NOW.getTime() - 10 * DAY),
        threadCountAtLastGen: 500,
        currentEligibleCount: threshold - 1,
      }),
    );
    expect(blocked.reason).toBe("NO_NEW_MAIL");

    const allowed = computeGenerationEligibility(
      base({
        lastOutcome: "SUCCESS",
        lastGeneratedAt: new Date(NOW.getTime() - 10 * DAY),
        threadCountAtLastGen: 500,
        currentEligibleCount: threshold,
      }),
    );
    expect(allowed.eligible).toBe(true);
  });

  it("enforces a cooldown after a failed/insufficient attempt", () => {
    const cooling = computeGenerationEligibility(
      base({ lastOutcome: "INSUFFICIENT", lastAttemptAt: new Date(NOW.getTime() - 1 * HOUR) }),
    );
    expect(cooling.reason).toBe("COOLDOWN");
    expect(cooling.nextEligibleAt).toBeDefined();

    const cooled = computeGenerationEligibility(
      base({ lastOutcome: "INSUFFICIENT", lastAttemptAt: new Date(NOW.getTime() - 7 * HOUR) }),
    );
    expect(cooled.eligible).toBe(true);
  });

  it("enforces the monthly backstop cap and resets after the window", () => {
    const capped = computeGenerationEligibility(
      base({ generationsInWindow: 3, generationsWindowStart: new Date(NOW.getTime() - 1 * DAY) }),
    );
    expect(capped.reason).toBe("MONTHLY_CAP");

    const reset = computeGenerationEligibility(
      base({ generationsInWindow: 3, generationsWindowStart: new Date(NOW.getTime() - 31 * DAY) }),
    );
    expect(reset.eligible).toBe(true);
  });

  it("too-small inbox takes priority over the monthly cap", () => {
    const r = computeGenerationEligibility(
      base({
        currentEligibleCount: 5,
        generationsInWindow: 3,
        generationsWindowStart: new Date(NOW.getTime() - 1 * DAY),
      }),
    );
    expect(r.reason).toBe("INBOX_TOO_SMALL");
  });
});

describe("emailDomain", () => {
  it("extracts and lowercases the domain", () => {
    expect(emailDomain("Alice@Example.COM")).toBe("example.com");
  });
  it("returns null for malformed addresses", () => {
    expect(emailDomain("not-an-email")).toBeNull();
    expect(emailDomain("trailing@")).toBeNull();
  });
});
