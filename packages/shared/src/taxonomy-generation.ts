// Shared types, tunable constants, and the pure eligibility logic for the
// auto-generate-taxonomy-from-inbox feature.
//
// This file is intentionally free of Prisma / DB imports so it can be unit
// tested in isolation and imported from web/mobile. The Prisma `where` builder
// that selects the same "eligible threads" lives in @amarnai/db
// (eligible-threads.ts) because it needs Prisma types.

// ─── Tunable constants (single source of truth) ────────────────────────────────

/** Minimum eligible (signal-bearing) threads required to attempt generation. */
export const GENERATION_MIN_ELIGIBLE_THREADS = 40;
/** Minimum distinct sender domains required to attempt generation. */
export const GENERATION_MIN_SENDER_DOMAINS = 8;

/** Delta gate: absolute floor of new eligible threads before a re-generate. */
export const GENERATION_DELTA_ABS = 200;
/** Delta gate: relative floor (fraction of the last count) before a re-generate. */
export const GENERATION_DELTA_PCT = 0.25;

/** Cooldown after a FAILED/INSUFFICIENT run before another attempt is allowed. */
export const GENERATION_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6h

/**
 * Max age of a RUNNING state before it is considered stale (the worker likely
 * crashed/stalled). Past this, a new generation is allowed and the UI surfaces
 * a failure instead of polling a stuck "running" forever.
 */
export const GENERATION_RUNNING_TTL_MS = 10 * 60 * 1000; // 10m

/** True when a RUNNING state is still fresh (a job is genuinely in flight). */
export function isGenerationRunningFresh(
  status: string,
  updatedAt: Date | null,
  now: Date,
): boolean {
  return (
    status === "RUNNING" &&
    updatedAt !== null &&
    now.getTime() - updatedAt.getTime() < GENERATION_RUNNING_TTL_MS
  );
}
/** Rolling window for the backstop quota. */
export const GENERATION_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30d

/** Backstop: max generations per rolling window, by plan. */
export const GENERATION_MONTHLY_CAP: Record<string, number> = {
  FREE: 3,
  PRO: 5,
  BUSINESS: 5,
};

/** Resolve the monthly generation cap for a plan (unknown plans → FREE). */
export function generationMonthlyCap(plan: string): number {
  return GENERATION_MONTHLY_CAP[plan] ?? GENERATION_MONTHLY_CAP["FREE"]!;
}

/** Threads needed to satisfy the delta gate given the last successful count. */
export function generationDeltaThreshold(lastCount: number): number {
  return lastCount + Math.max(GENERATION_DELTA_ABS, Math.ceil(lastCount * GENERATION_DELTA_PCT));
}

/** Lowercased domain part of an email address, or null if malformed. */
export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at === -1 || at === email.length - 1) return null;
  return email.slice(at + 1).toLowerCase();
}

// ─── Profile + eligibility types ───────────────────────────────────────────────

/** A frequency-ranked aggregate. */
export interface ProfileTerm {
  term: string;
  count: number;
}

/** A top sender domain paired with its co-occurring subject keywords. */
export interface SenderCluster {
  label: string;
  count: number;
  keywords: ProfileTerm[];
}

/**
 * Compact, body-free aggregate of a workspace's eligible inbox, used as the
 * LLM input for taxonomy generation. Built fresh per run and discarded after
 * generation (never persisted).
 */
export interface InboxProfile {
  /** Count of eligible threads the profile was built from. */
  eligibleThreadCount: number;
  /** Distinct sender domains, frequency-ranked. */
  senderDomains: ProfileTerm[];
  /** Sender display names, frequency-ranked. */
  senderNames: ProfileTerm[];
  /** Subject keyword clusters, frequency-ranked (raw subjects never included). */
  subjectKeywords: ProfileTerm[];
  /** Gmail label names + counts. */
  gmailLabels: ProfileTerm[];
  /** Top sender domains with their co-occurring subject keywords. */
  senderClusters: SenderCluster[];
}

export type GenerationEligibilityReason =
  | "OK"
  | "INBOX_TOO_SMALL"
  | "NO_NEW_MAIL"
  | "COOLDOWN"
  | "MONTHLY_CAP"
  | "IMPORTING";

export interface GenerationEligibility {
  eligible: boolean;
  reason: GenerationEligibilityReason;
  /** ISO timestamp when the user can try again (for time-based reasons). */
  nextEligibleAt?: string;
}

export interface GenerationEligibilityInput {
  /** Outcome of the last completed run, or null if never run. */
  lastOutcome: string | null;
  /** Timestamp of the last successful generation (drives the delta gate). */
  lastGeneratedAt: Date | null;
  /** Eligible-thread count captured at the last successful generation. */
  threadCountAtLastGen: number | null;
  /** Timestamp of the last completed attempt of any outcome (drives cooldown). */
  lastAttemptAt: Date | null;
  /** Current eligible-thread count. */
  currentEligibleCount: number;
  /** Current distinct sender-domain count. */
  currentSenderDomainCount: number;
  /** Backstop window start + usage. */
  generationsWindowStart: Date | null;
  generationsInWindow: number;
  plan: string;
  now: Date;
}

/**
 * Pure cost-limiter decision. Returns whether a (re)generation is allowed and,
 * if not, why and when it will be allowed again. Does not consider an in-flight
 * RUNNING job — the API rejects those separately with a 409.
 */
export function computeGenerationEligibility(input: GenerationEligibilityInput): GenerationEligibility {
  const {
    lastOutcome,
    lastGeneratedAt,
    threadCountAtLastGen,
    lastAttemptAt,
    currentEligibleCount,
    currentSenderDomainCount,
    generationsWindowStart,
    generationsInWindow,
    plan,
    now,
  } = input;

  // 1. Inbox must carry enough signal at all — independent of any quota.
  if (
    currentEligibleCount < GENERATION_MIN_ELIGIBLE_THREADS ||
    currentSenderDomainCount < GENERATION_MIN_SENDER_DOMAINS
  ) {
    return { eligible: false, reason: "INBOX_TOO_SMALL" };
  }

  // 2. Backstop quota (hard cap within the rolling window).
  const windowActive =
    generationsWindowStart !== null &&
    now.getTime() - generationsWindowStart.getTime() < GENERATION_WINDOW_MS;
  const usedInWindow = windowActive ? generationsInWindow : 0;
  if (usedInWindow >= generationMonthlyCap(plan) && generationsWindowStart !== null && windowActive) {
    return {
      eligible: false,
      reason: "MONTHLY_CAP",
      nextEligibleAt: new Date(generationsWindowStart.getTime() + GENERATION_WINDOW_MS).toISOString(),
    };
  }

  // 3. Cooldown after a failed/insufficient attempt.
  if (
    (lastOutcome === "FAILED" || lastOutcome === "INSUFFICIENT") &&
    lastAttemptAt !== null &&
    now.getTime() - lastAttemptAt.getTime() < GENERATION_COOLDOWN_MS
  ) {
    return {
      eligible: false,
      reason: "COOLDOWN",
      nextEligibleAt: new Date(lastAttemptAt.getTime() + GENERATION_COOLDOWN_MS).toISOString(),
    };
  }

  // 4. Delta gate after a successful generation.
  if (lastGeneratedAt !== null && threadCountAtLastGen !== null) {
    if (currentEligibleCount < generationDeltaThreshold(threadCountAtLastGen)) {
      return { eligible: false, reason: "NO_NEW_MAIL" };
    }
  }

  return { eligible: true, reason: "OK" };
}
