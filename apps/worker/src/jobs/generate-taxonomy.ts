import { Worker } from "bullmq";
import { db, eligibleThreadWhere } from "@amarnai/db";
import { createAIProvider, getTaxonomyAIProviderConfig, generateTaxonomyFromProfile } from "@amarnai/ai";
import { matchTemplateToProfile, layoutTaxonomyTransfer } from "@amarnai/core/taxonomy";
import {
  computeGenerationEligibility,
  emailDomain,
  GENERATION_WINDOW_MS,
  type InboxProfile,
  type ProfileTerm,
  type SenderCluster,
} from "@amarnai/shared";
import {
  generateTaxonomyQueue,
  QUEUE_GENERATE_TAXONOMY,
  type GenerateTaxonomyJobData,
} from "../queues.js";
import { redisConnection } from "../redis.js";

// ─── Aggregation ────────────────────────────────────────────────────────────────

/** Max messages sampled to build the profile signal (most recent first). */
const SAMPLE_MESSAGE_LIMIT = 3000;
/** Keep at most this many of each ranked signal in the profile. */
const TOP_TERMS = 60;
/** Drop subject keywords seen fewer than this many times (noise + privacy). */
const MIN_KEYWORD_COUNT = 2;
/** Top sender domains to include in per-domain keyword clusters. */
const CLUSTER_DOMAIN_LIMIT = 12;
/** Keywords kept per sender cluster. */
const CLUSTER_KEYWORD_LIMIT = 8;

const SUBJECT_STOP_WORDS = new Set([
  "the", "and", "for", "with", "from", "your", "you", "are", "our", "this",
  "that", "all", "any", "re", "fwd", "fw", "to", "of", "in", "on", "at", "by",
  "or", "is", "it", "was", "new", "please", "hi", "hello", "thanks", "thank",
  "regarding", "update", "updates", "notification", "no", "reply", "noreply",
]);

/** Looks like an email address or a long digit run — never used as a keyword. */
function isPiiToken(token: string): boolean {
  return /\d{4,}/.test(token);
}

function tokenizeSubject(subject: string): string[] {
  return subject
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !SUBJECT_STOP_WORDS.has(t) && !isPiiToken(t));
}

/** Rank a count map into the top-N ProfileTerms (ties broken by term for determinism). */
function rank(counts: Map<string, number>, limit: number, minCount = 1): ProfileTerm[] {
  return [...counts.entries()]
    .filter(([, c]) => c >= minCount)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([term, count]) => ({ term, count }));
}

/** Gmail system labels that carry no taxonomy signal. */
const SYSTEM_LABEL_RE = /^(INBOX|SENT|DRAFT|SPAM|TRASH|UNREAD|STARRED|IMPORTANT|CHAT|CATEGORY_)/i;

/**
 * Build a body-free aggregate profile of the workspace's eligible inbox. Reads
 * only persisted rows. `isAutomated` and the other exclusions are applied via
 * the shared eligibleThreadWhere predicate — never recomputed here.
 */
export async function buildInboxProfile(
  workspaceId: string,
  settings: { includeSpam: boolean; includePromotions: boolean; blacklistedSenderEmails: string[] },
): Promise<InboxProfile> {
  const threadWhere = eligibleThreadWhere(workspaceId, settings);

  const eligibleThreadCount = await db.emailThread.count({ where: threadWhere });

  // Sample recent messages from eligible threads for the sender/subject signal.
  const messages = await db.emailMessage.findMany({
    where: { thread: threadWhere },
    select: { senderEmail: true, senderName: true, subject: true },
    orderBy: { receivedAt: "desc" },
    take: SAMPLE_MESSAGE_LIMIT,
  });

  const domains = new Map<string, number>();
  const names = new Map<string, number>();
  const keywords = new Map<string, number>();
  const perDomainKeywords = new Map<string, Map<string, number>>();
  for (const m of messages) {
    const domain = emailDomain(m.senderEmail);
    if (domain) domains.set(domain, (domains.get(domain) ?? 0) + 1);
    const name = m.senderName?.trim();
    if (name) names.set(name, (names.get(name) ?? 0) + 1);
    if (m.subject) {
      const tokens = tokenizeSubject(m.subject);
      for (const token of tokens) {
        keywords.set(token, (keywords.get(token) ?? 0) + 1);
      }
      if (domain && tokens.length > 0) {
        const dk = perDomainKeywords.get(domain) ?? new Map<string, number>();
        for (const token of tokens) {
          dk.set(token, (dk.get(token) ?? 0) + 1);
        }
        perDomainKeywords.set(domain, dk);
      }
    }
  }

  // Gmail labels (custom user labels) + per-eligible-thread counts.
  const gmailLabels = new Map<string, number>();
  try {
    const tags = await db.tag.findMany({
      where: { workspaceId, source: "GMAIL" },
      select: { id: true, name: true },
    });
    const nameById = new Map(tags.map((t) => [t.id, t.name]));
    const usableIds = tags.filter((t) => !SYSTEM_LABEL_RE.test(t.name)).map((t) => t.id);
    if (usableIds.length > 0) {
      const grouped = await db.emailTag.groupBy({
        by: ["tagId"],
        where: { tagId: { in: usableIds }, emailThread: threadWhere },
        _count: { tagId: true },
      });
      for (const g of grouped) {
        const name = nameById.get(g.tagId);
        if (name) gmailLabels.set(name, g._count.tagId);
      }
    }
  } catch (err) {
    // Labels are a secondary signal — never fail generation over them.
    console.error(`[generate-taxonomy] label aggregation failed for ${workspaceId}:`, err);
  }

  const topDomains = rank(domains, CLUSTER_DOMAIN_LIMIT);
  const senderClusters: SenderCluster[] = topDomains.map((d) => ({
    label: d.term,
    count: d.count,
    keywords: rank(perDomainKeywords.get(d.term) ?? new Map(), CLUSTER_KEYWORD_LIMIT, MIN_KEYWORD_COUNT),
  }));

  return {
    eligibleThreadCount,
    senderDomains: rank(domains, TOP_TERMS),
    senderNames: rank(names, TOP_TERMS),
    subjectKeywords: rank(keywords, TOP_TERMS, MIN_KEYWORD_COUNT),
    gmailLabels: rank(gmailLabels, TOP_TERMS),
    senderClusters,
  };
}

// ─── Job ─────────────────────────────────────────────────────────────────────

/** Upsert helper so a missing state row is created on first run. */
async function setState(
  workspaceId: string,
  data: Parameters<typeof db.taxonomyGenerationState.update>[0]["data"],
): Promise<void> {
  await db.taxonomyGenerationState.upsert({
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
export async function runGenerateTaxonomyJob(workspaceId: string): Promise<void> {
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

  await setState(workspaceId, { status: "RUNNING" });

  // Build the body-free profile (no LLM cost).
  const profile = await buildInboxProfile(workspaceId, settings);

  // Re-check the full limiter at run time so a race (two requests slipping past
  // the API check) cannot double-spend. lastAttemptAt is the row's updatedAt.
  const now = new Date();
  const eligibility = computeGenerationEligibility({
    lastOutcome: state?.lastOutcome ?? null,
    lastGeneratedAt: state?.lastGeneratedAt ?? null,
    threadCountAtLastGen: state?.threadCountAtLastGen ?? null,
    lastAttemptAt: state?.updatedAt ?? null,
    currentEligibleCount: profile.eligibleThreadCount,
    currentSenderDomainCount: profile.senderDomains.length,
    generationsWindowStart: state?.generationsWindowStart ?? null,
    generationsInWindow: state?.generationsInWindow ?? 0,
    plan: workspace.plan,
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

  // Match a template (deterministic) and personalize with the LLM.
  const template = matchTemplateToProfile(profile);
  const provider = createAIProvider(getTaxonomyAIProviderConfig());

  const generated = await generateTaxonomyFromProfile({
    profile,
    seed: template.file,
    matchedTemplateName: template.name,
    provider,
    now,
  });

  // Positions from the LLM are arbitrary; lay the tree out left-to-right with the
  // same convention as the templates so it renders cleanly on the canvas.
  const result = { ...generated, file: layoutTaxonomyTransfer(generated.file) };

  // Roll the backstop window if it has expired, then count this run.
  const windowActive =
    state?.generationsWindowStart != null &&
    now.getTime() - state.generationsWindowStart.getTime() < GENERATION_WINDOW_MS;
  const generationsWindowStart = windowActive ? state!.generationsWindowStart! : now;
  const generationsInWindow = (windowActive ? state!.generationsInWindow : 0) + 1;

  await setState(workspaceId, {
    status: "READY",
    proposal: result.file as unknown as object,
    matchedTemplateId: template.id,
    lastGeneratedAt: now,
    threadCountAtLastGen: profile.eligibleThreadCount,
    lastOutcome: "SUCCESS",
    generationsWindowStart,
    generationsInWindow,
    modelProvider: provider.providerName,
    modelName: provider.modelName,
  });

  console.log(
    `[generate-taxonomy] ${workspaceId} READY — template=${template.id} fallback=${result.usedFallback} threads=${profile.eligibleThreadCount}`,
  );
}

// ─── Worker ─────────────────────────────────────────────────────────────────

export function createGenerateTaxonomyWorker(): Worker {
  const worker = new Worker<GenerateTaxonomyJobData>(
    QUEUE_GENERATE_TAXONOMY,
    (job) => runGenerateTaxonomyJob(job.data.workspaceId),
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
