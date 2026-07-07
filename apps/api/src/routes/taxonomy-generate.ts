import { Hono } from "hono";
import { z } from "zod";
import { db, eligibleThreadWhere, resolveInboxQuota } from "@amarnai/db";
import {
  computeGenerationEligibility,
  emailDomain,
  isGenerationRunningFresh,
  type GenerationEligibility,
} from "@amarnai/shared";
import { config } from "@amarnai/config";
import type { AppEnv } from "../env.js";
import { isTaxonomyEditor } from "../services/taxonomy-permission.js";
import { generateTaxonomyQueue } from "../services/queue-client.js";

const workspaceParam = z.object({ workspaceId: z.string().min(1) });

// Bounded distinct-sender sample: enough to confirm the domain-count floor
// without scanning the whole inbox on every status poll.
const DOMAIN_SAMPLE_LIMIT = 150;

const taxonomyGenerate = new Hono<AppEnv>();

interface EvalResult {
  state: Awaited<ReturnType<typeof db.taxonomyGenerationState.findUnique>>;
  eligibility: GenerationEligibility;
  eligibleThreadCount: number;
  /** True while the historical backfill is still ingesting the inbox. */
  importing: boolean;
}

/**
 * Compute the current generation eligibility for a workspace. Cheap: an eligible
 * thread COUNT plus a bounded distinct-sender sample for the domain floor. The
 * worker does the precise (full-profile) domain check before any LLM call, so a
 * rare over-estimate here never costs money.
 */
async function evaluate(workspaceId: string): Promise<EvalResult> {
  const [workspace, settingsRow, state, syncState, connection] = await Promise.all([
    db.workspace.findUnique({ where: { id: workspaceId }, select: { plan: true } }),
    db.gmailSyncSettings.findUnique({ where: { workspaceId } }),
    db.taxonomyGenerationState.findUnique({ where: { workspaceId } }),
    db.providerSyncState.findFirst({
      where: { emailAccount: { workspaceId } },
      select: { backfillStatus: true },
    }),
    db.emailConnection.findUnique({ where: { workspaceId }, select: { emailAddress: true } }),
  ]);

  // Backstop quota counters come from the reset-immune, inbox-pooled meter
  // (calendar-month window), sized by the top plan among workspaces sharing the
  // inbox. Falls back to the workspace plan with no window for the no-connection
  // path (generation can't run without an inbox anyway).
  const now = new Date();
  const enforceTaxonomy = config.billing.enforceTaxonomyQuota;
  const quota = connection ? await resolveInboxQuota(connection.emailAddress, "TAXONOMY_GEN", now) : null;
  const genPlan = quota?.plan ?? workspace?.plan ?? "FREE";
  // The cap is only ENFORCED when the flag is on (self-host can opt out); a null
  // window makes computeGenerationEligibility skip the backstop branch.
  const genWindowStart = enforceTaxonomy ? quota?.windowStart ?? null : null;
  const genInWindow = enforceTaxonomy ? quota?.used ?? 0 : 0;

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
    generationsWindowStart: genWindowStart,
    generationsInWindow: genInWindow,
    plan: genPlan,
    now,
  });

  const importing =
    syncState?.backfillStatus === "PENDING" || syncState?.backfillStatus === "RUNNING";

  // Surface a friendlier reason while the historical backfill is still ingesting:
  // the inbox is "too small" only because it hasn't finished importing yet.
  if (eligibility.reason === "INBOX_TOO_SMALL" && importing) {
    eligibility.reason = "IMPORTING";
  }

  return { state, eligibility, eligibleThreadCount, importing };
}

// POST — request a (re)generation. Requires taxonomy-edit permission. Enqueues
// the worker job after the limiter check; 403 if not an editor, 409 if a fresh
// run is already in progress, 429 if the limiter denies it.
taxonomyGenerate.post("/workspaces/:workspaceId/taxonomy-generate", async (c) => {
  const params = workspaceParam.safeParse({ workspaceId: c.req.param("workspaceId") });
  if (!params.success) return c.json({ error: "Invalid workspace ID" }, 400);
  const { workspaceId } = params.data;

  // Authorization: generation spends LLM budget and produces a proposal that can
  // replace the taxonomy, so it is restricted to taxonomy editors (membership
  // alone is not enough). Native/proxy callers reach here without the web gate.
  const userId = c.get("userId");
  if (!userId || !(await isTaxonomyEditor(workspaceId, userId))) {
    return c.json({ error: "Taxonomy editing is restricted to workspace admins" }, 403);
  }

  const { state, eligibility } = await evaluate(workspaceId);

  // A genuinely in-flight run blocks a new one; a stale RUNNING (crashed/stalled
  // worker) does not — it is treated as recoverable so the user is never stuck.
  if (state && isGenerationRunningFresh(state.status, state.updatedAt, new Date())) {
    return c.json({ error: "Generation already in progress" }, 409);
  }
  if (!eligibility.eligible) {
    return c.json(
      { error: "Not eligible", reason: eligibility.reason, nextEligibleAt: eligibility.nextEligibleAt },
      429,
    );
  }

  // Mark RUNNING before enqueue so a concurrent request sees it (the worker
  // re-checks the full limiter before spending the LLM call). If the enqueue
  // fails, roll the status back so the workspace is not stuck RUNNING.
  await db.taxonomyGenerationState.upsert({
    where: { workspaceId },
    create: { workspaceId, status: "RUNNING" },
    update: { status: "RUNNING" },
  });

  // The taxonomy is generated in the workspace's language (shared by everyone in
  // the workspace), not the triggering user's, so the result is consistent
  // regardless of who triggers it.
  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { locale: true },
  });

  try {
    await generateTaxonomyQueue.add(
      "generate-taxonomy",
      { workspaceId, ...(workspace?.locale ? { locale: workspace.locale } : {}) },
      { deduplication: { id: `generate-taxonomy_${workspaceId}` } },
    );
  } catch (err) {
    await db.taxonomyGenerationState.update({
      where: { workspaceId },
      data: { status: state?.proposal ? "READY" : "IDLE" },
    });
    throw err;
  }

  return c.json({ ok: true, status: "RUNNING" }, 202);
});

// GET — current status, eligibility, and the latest READY proposal (for preview).
taxonomyGenerate.get("/workspaces/:workspaceId/taxonomy-generate", async (c) => {
  const params = workspaceParam.safeParse({ workspaceId: c.req.param("workspaceId") });
  if (!params.success) return c.json({ error: "Invalid workspace ID" }, 400);
  const { workspaceId } = params.data;

  const { state, eligibility, importing } = await evaluate(workspaceId);

  // Report a stale RUNNING (crashed/stalled worker) as FAILED so the client stops
  // polling forever and offers a retry, without a write from a GET.
  const rawStatus = state?.status ?? "IDLE";
  const status =
    rawStatus === "RUNNING" && !isGenerationRunningFresh(rawStatus, state?.updatedAt ?? null, new Date())
      ? "FAILED"
      : rawStatus;

  return c.json({
    status,
    eligibility,
    importing,
    matchedTemplateId: state?.matchedTemplateId ?? null,
    lastOutcome: state?.lastOutcome ?? null,
    // Only expose the proposal when it is the current READY result.
    proposal: status === "READY" ? state?.proposal ?? null : null,
  });
});

export { taxonomyGenerate as taxonomyGenerateRoute };
