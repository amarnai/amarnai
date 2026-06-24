import { Hono } from "hono";
import { z } from "zod";
import { db, eligibleThreadWhere } from "@amarnai/db";
import {
  computeGenerationEligibility,
  emailDomain,
  type GenerationEligibility,
} from "@amarnai/shared";
import { generateTaxonomyQueue } from "../services/queue-client.js";

const workspaceParam = z.object({ workspaceId: z.string().min(1) });

// Bounded distinct-sender sample: enough to confirm the domain-count floor
// without scanning the whole inbox on every status poll.
const DOMAIN_SAMPLE_LIMIT = 150;

const taxonomyGenerate = new Hono();

interface EvalResult {
  state: Awaited<ReturnType<typeof db.taxonomyGenerationState.findUnique>>;
  eligibility: GenerationEligibility;
  eligibleThreadCount: number;
}

/**
 * Compute the current generation eligibility for a workspace. Cheap: an eligible
 * thread COUNT plus a bounded distinct-sender sample for the domain floor. The
 * worker does the precise (full-profile) domain check before any LLM call, so a
 * rare over-estimate here never costs money.
 */
async function evaluate(workspaceId: string): Promise<EvalResult> {
  const [workspace, settingsRow, state, syncState] = await Promise.all([
    db.workspace.findUnique({ where: { id: workspaceId }, select: { plan: true } }),
    db.gmailSyncSettings.findUnique({ where: { workspaceId } }),
    db.taxonomyGenerationState.findUnique({ where: { workspaceId } }),
    db.providerSyncState.findFirst({
      where: { emailAccount: { workspaceId } },
      select: { backfillStatus: true },
    }),
  ]);

  const settings = {
    includeSpam: settingsRow?.includeSpam ?? false,
    includePromotions: settingsRow?.includePromotions ?? false,
    blacklistedSenderEmails: settingsRow?.blacklistedSenderEmails ?? [],
  };
  const where = eligibleThreadWhere(workspaceId, settings);

  const [eligibleThreadCount, distinctSenders] = await Promise.all([
    db.emailThread.count({ where }),
    db.emailMessage.findMany({
      where: { thread: where },
      distinct: ["senderEmail"],
      select: { senderEmail: true },
      take: DOMAIN_SAMPLE_LIMIT,
    }),
  ]);

  const domainCount = new Set(
    distinctSenders.map((s) => emailDomain(s.senderEmail)).filter((d): d is string => d !== null),
  ).size;

  const eligibility = computeGenerationEligibility({
    lastOutcome: state?.lastOutcome ?? null,
    lastGeneratedAt: state?.lastGeneratedAt ?? null,
    threadCountAtLastGen: state?.threadCountAtLastGen ?? null,
    lastAttemptAt: state?.updatedAt ?? null,
    currentEligibleCount: eligibleThreadCount,
    currentSenderDomainCount: domainCount,
    generationsWindowStart: state?.generationsWindowStart ?? null,
    generationsInWindow: state?.generationsInWindow ?? 0,
    plan: workspace?.plan ?? "FREE",
    now: new Date(),
  });

  // Surface a friendlier reason while the historical backfill is still ingesting:
  // the inbox is "too small" only because it hasn't finished importing yet.
  if (
    eligibility.reason === "INBOX_TOO_SMALL" &&
    (syncState?.backfillStatus === "PENDING" || syncState?.backfillStatus === "RUNNING")
  ) {
    eligibility.reason = "IMPORTING";
  }

  return { state, eligibility, eligibleThreadCount };
}

// POST — request a (re)generation. Enqueues the worker job after the limiter
// check; returns 409 if one is already running, 429 if the limiter denies it.
taxonomyGenerate.post("/workspaces/:workspaceId/taxonomy-generate", async (c) => {
  const params = workspaceParam.safeParse({ workspaceId: c.req.param("workspaceId") });
  if (!params.success) return c.json({ error: "Invalid workspace ID" }, 400);
  const { workspaceId } = params.data;

  const { state, eligibility } = await evaluate(workspaceId);

  if (state?.status === "RUNNING") {
    return c.json({ error: "Generation already in progress" }, 409);
  }
  if (!eligibility.eligible) {
    return c.json(
      { error: "Not eligible", reason: eligibility.reason, nextEligibleAt: eligibility.nextEligibleAt },
      429,
    );
  }

  // Mark RUNNING before enqueue so a concurrent request sees it (the worker
  // re-checks the full limiter before spending the LLM call).
  await db.taxonomyGenerationState.upsert({
    where: { workspaceId },
    create: { workspaceId, status: "RUNNING" },
    update: { status: "RUNNING" },
  });

  await generateTaxonomyQueue.add(
    "generate-taxonomy",
    { workspaceId },
    { deduplication: { id: `generate-taxonomy_${workspaceId}` } },
  );

  return c.json({ ok: true, status: "RUNNING" }, 202);
});

// GET — current status, eligibility, and the latest READY proposal (for preview).
taxonomyGenerate.get("/workspaces/:workspaceId/taxonomy-generate", async (c) => {
  const params = workspaceParam.safeParse({ workspaceId: c.req.param("workspaceId") });
  if (!params.success) return c.json({ error: "Invalid workspace ID" }, 400);
  const { workspaceId } = params.data;

  const { state, eligibility } = await evaluate(workspaceId);

  return c.json({
    status: state?.status ?? "IDLE",
    eligibility,
    matchedTemplateId: state?.matchedTemplateId ?? null,
    lastOutcome: state?.lastOutcome ?? null,
    // Only expose the proposal when it is the current READY result.
    proposal: state?.status === "READY" ? state.proposal : null,
  });
});

export { taxonomyGenerate as taxonomyGenerateRoute };
