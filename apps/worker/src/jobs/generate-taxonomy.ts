import { Worker } from "bullmq";
import { db, buildInboxProfile, resolveInboxQuota, recordMeterUsage, taxonomyGenDedupToken, Prisma } from "@aziru/db";
import {
  createAIProvider,
  getTaxonomyAIProviderConfig,
  generateTaxonomyFromProfile,
} from "@aziru/ai";
import { config } from "@aziru/config";
import { matchTemplateToProfile, layoutTaxonomyTransfer, localizeTransferFile } from "@aziru/core/taxonomy";
import { setupI18n } from "@lingui/core";
import { loadCatalog, matchLocale, translateSource, LOCALE_ENGLISH_LANGUAGE_NAMES } from "@aziru/i18n";
import { computeGenerationEligibility } from "@aziru/shared";
import {
  generateTaxonomyQueue,
  QUEUE_GENERATE_TAXONOMY,
  type GenerateTaxonomyJobData,
} from "../queues.js";
import { redisConnection } from "../redis.js";

// ─── Job ─────────────────────────────────────────────────────────────────────

/** Upsert helper so a missing state row is created on first run. Accepts an
 * optional transaction client so the terminal READY write can commit atomically
 * with the usage meter (see the $transaction in runGenerateTaxonomyJob). */
async function setState(
  workspaceId: string,
  data: Parameters<typeof db.taxonomyGenerationState.update>[0]["data"],
  client: typeof db | Prisma.TransactionClient = db,
): Promise<void> {
  await client.taxonomyGenerationState.upsert({
    where: { workspaceId },
    create: { workspaceId, ...(data as object) },
    update: data,
  });
}

/**
 * Generate a personalized taxonomy proposal for a workspace from its eligible
 * inbox, store it for preview, and update the cost-limiter counters. Exported
 * separately from the BullMQ wiring so it is unit-testable without Redis.
 *
 * Idempotent and retry-safe: re-reads state, re-checks eligibility before the
 * (paid) LLM call, and records a terminal outcome in every branch. Never calls
 * the LLM when the inbox is insufficient or the limiter denies the run.
 */
export async function runGenerateTaxonomyJob(
  workspaceId: string,
  locale?: string,
  idempotencyKey?: string,
): Promise<void> {
  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { plan: true },
  });
  if (!workspace) {
    console.log(`[generate-taxonomy] Workspace ${workspaceId} not found — skipping`);
    return;
  }

  const settingsRow = await db.gmailSyncSettings.findUnique({ where: { workspaceId } });
  const settings = {
    includeSpam: settingsRow?.includeSpam ?? false,
    includePromotions: settingsRow?.includePromotions ?? false,
    blacklistedSenderEmails: settingsRow?.blacklistedSenderEmails ?? [],
  };

  const state = await db.taxonomyGenerationState.findUnique({ where: { workspaceId } });
  const connection = await db.emailConnection.findUnique({
    where: { workspaceId },
    select: { emailAddress: true },
  });

  await setState(workspaceId, { status: "RUNNING" });

  // Build the body-free profile (no LLM cost).
  const profile = await buildInboxProfile(workspaceId, settings);

  // Re-check the full limiter at run time so a race (two requests slipping past
  // the API check) cannot double-spend. lastAttemptAt is the row's updatedAt.
  const now = new Date();
  // Backstop quota counters now live on the reset-immune, inbox-pooled meter
  // (calendar-month window) rather than on the reset-wiped TaxonomyGenerationState.
  // The delta gate (lastGeneratedAt) and cooldown (lastOutcome) stay on the state
  // row — those are workspace-local UX state and correctly reset. `recordWindow`
  // is always the calendar month (usage recorded for observability); the cap is
  // only ENFORCED when enforceTaxonomyQuota is on (self-host can opt out).
  const quota = connection ? await resolveInboxQuota(connection.emailAddress, "TAXONOMY_GEN", now) : null;
  const enforceTaxonomy = config.billing.enforceTaxonomyQuota;
  const genPlan = quota?.plan ?? workspace.plan;
  // The cap is only ENFORCED when the flag is on; a null window makes the backstop
  // branch in computeGenerationEligibility inert. Usage is still recorded below.
  const genWindowStart = enforceTaxonomy ? quota?.windowStart ?? null : null;
  const genInWindow = enforceTaxonomy ? quota?.used ?? 0 : 0;

  const eligibility = computeGenerationEligibility({
    lastOutcome: state?.lastOutcome ?? null,
    lastGeneratedAt: state?.lastGeneratedAt ?? null,
    threadCountAtLastGen: state?.threadCountAtLastGen ?? null,
    lastAttemptAt: state?.updatedAt ?? null,
    currentEligibleCount: profile.eligibleThreadCount,
    currentSenderDomainCount: profile.senderDomains.length,
    generationsWindowStart: genWindowStart,
    generationsInWindow: genInWindow,
    plan: genPlan,
    now,
  });

  if (!eligibility.eligible) {
    if (eligibility.reason === "INBOX_TOO_SMALL") {
      await setState(workspaceId, { status: "INSUFFICIENT", lastOutcome: "INSUFFICIENT" });
      console.log(`[generate-taxonomy] ${workspaceId} insufficient inbox — no LLM call`);
      return;
    }
    // A limiter race (NO_NEW_MAIL / COOLDOWN / MONTHLY_CAP): restore prior state.
    await setState(workspaceId, {
      status: state?.proposal ? "READY" : "IDLE",
    });
    console.log(`[generate-taxonomy] ${workspaceId} not eligible (${eligibility.reason}) — skipped`);
    return;
  }

  // Match a template (deterministic) and personalize with the LLM. The model is
  // told to write in the triggering user's language; the fallback seed is
  // localized the same way taxonomy templates are, so a non-English user never
  // gets an English taxonomy when the LLM output is unusable.
  const template = matchTemplateToProfile(profile);
  const provider = createAIProvider(getTaxonomyAIProviderConfig());

  const resolvedLocale = matchLocale(locale ? [locale] : []);
  const li = setupI18n({
    locale: resolvedLocale,
    messages: { [resolvedLocale]: await loadCatalog(resolvedLocale) },
  });
  const translate = (s: string): string => translateSource(li, s);

  const generated = await generateTaxonomyFromProfile({
    profile,
    seed: template.file,
    matchedTemplateName: template.name,
    targetLanguage: LOCALE_ENGLISH_LANGUAGE_NAMES[resolvedLocale],
    fallbackSeed: localizeTransferFile(template.file, translate),
    provider,
    now,
  });

  // Positions from the LLM are arbitrary; lay the tree out left-to-right with the
  // same convention as the templates so it renders cleanly on the canvas.
  const result = { ...generated, file: layoutTaxonomyTransfer(generated.file) };

  // Persist the meter increment and the READY proposal in ONE transaction. These
  // were previously two separate awaits: a crash after the meter but before the
  // proposal charged the user for a generation whose result was lost (and, once the
  // attempt went terminal, the FAILED cooldown then blocked the retry for 6h).
  // Coupling them means a crash rolls back both — never charged without a saved
  // proposal. The meter is keyed on the job's idempotency key (the marker committed
  // atomically with the proposal), so a retry that re-runs the already-committed
  // generation is a no-op on the meter — the retry is gated on the marker, not the
  // cooldown timestamp a crashed attempt already advanced. (The LLM re-call on a
  // pre-commit crash is inherent to a non-transactional external effect; the
  // eligibility delta-gate short-circuits it once a proposal exists.)
  // Always recorded (even when enforcement is off) for observability.
  //
  // The dedup token is the job's idempotency key. If it is ever absent (a direct or
  // non-BullMQ call), fall OPEN — no token — so the meter simply counts. The prior
  // `?? workspaceId` fallback produced a per-workspace-CONSTANT token: once claimed,
  // every future generation for that workspace would find it already claimed and skip
  // the increment forever (a silent under-count). Failing open to "count" is the safe
  // direction; the transaction + eligibility delta-gate still prevent a same-run retry
  // from double-counting even without a token.
  const dedupToken = idempotencyKey ? taxonomyGenDedupToken(idempotencyKey) : undefined;
  await db.$transaction(async (tx) => {
    if (quota) {
      await recordMeterUsage({
        inboxKey: quota.inboxKey,
        kind: "TAXONOMY_GEN",
        windowStart: quota.windowStart,
        delta: 1,
        sizedForPlan: genPlan,
        // Omit entirely when absent (fail-open); do not pass `undefined`.
        ...(dedupToken ? { dedupToken } : {}),
        tx,
      });
    }

    await setState(
      workspaceId,
      {
        status: "READY",
        proposal: result.file as unknown as object,
        matchedTemplateId: template.id,
        lastGeneratedAt: now,
        threadCountAtLastGen: profile.eligibleThreadCount,
        lastOutcome: "SUCCESS",
        modelProvider: provider.providerName,
        modelName: provider.modelName,
      },
      tx,
    );
  });

  console.log(
    `[generate-taxonomy] ${workspaceId} READY — template=${template.id} fallback=${result.usedFallback} threads=${profile.eligibleThreadCount}`,
  );
}

// ─── Worker ─────────────────────────────────────────────────────────────────

export function createGenerateTaxonomyWorker(): Worker {
  const worker = new Worker<GenerateTaxonomyJobData>(
    QUEUE_GENERATE_TAXONOMY,
    (job) => runGenerateTaxonomyJob(job.data.workspaceId, job.data.locale, job.id),
    {
      connection: redisConnection,
      // One LLM call per job; a small pool is plenty.
      concurrency: 3,
    },
  );

  // Record a terminal FAILED outcome so the UI can surface it and the cooldown
  // applies. The queue retries (attempts > 1), so only the LAST attempt is
  // terminal — earlier failures will be retried and must not write FAILED, which
  // would flip the UI to failed mid-retry and (via the cooldown) block the
  // retry that follows. The job leaves state at RUNNING between attempts.
  worker.on("failed", (job, err) => {
    const workspaceId = job?.data.workspaceId;
    if (!workspaceId) return;
    const attempts = job?.opts.attempts ?? 1;
    const isTerminal = (job?.attemptsMade ?? 0) >= attempts;
    console.error(
      `[generate-taxonomy] ${workspaceId} attempt ${job?.attemptsMade}/${attempts} failed${isTerminal ? " (terminal)" : " — will retry"}:`,
      err,
    );
    if (!isTerminal) return;
    void db.taxonomyGenerationState
      .upsert({
        where: { workspaceId },
        create: { workspaceId, status: "FAILED", lastOutcome: "FAILED" },
        update: { status: "FAILED", lastOutcome: "FAILED" },
      })
      .catch((e) => console.error(`[generate-taxonomy] failed to mark FAILED for ${workspaceId}:`, e));
  });

  return worker;
}

export { generateTaxonomyQueue };
