import { Worker } from "bullmq";
import {
  db,
  eligibleThreadWhere,
  getInboxPlanCeiling,
  inboxKeyFor,
  meterWindowStart,
  getMeterUsed,
  recordMeterUsage,
} from "@amarnai/db";
import {
  createAIProvider,
  getTaxonomyAIProviderConfig,
  generateTaxonomyFromProfile,
  senderIsNoReply,
} from "@amarnai/ai";
import { config } from "@amarnai/config";
import { matchTemplateToProfile, layoutTaxonomyTransfer, localizeTransferFile } from "@amarnai/core/taxonomy";
import { setupI18n } from "@lingui/core";
import { loadCatalog, matchLocale, translateSource, LOCALE_ENGLISH_LANGUAGE_NAMES } from "@amarnai/i18n";
import {
  computeGenerationEligibility,
  emailDomain,
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
/**
 * A sender domain whose mail is at least this fraction no-reply is treated as
 * machine traffic with no folder of its own and dropped from every
 * folder-defining signal. Domains that mix human and no-reply mail (a real
 * contact at a company that also sends alerts) stay below the threshold.
 */
const NOREPLY_DOMAIN_SHARE = 0.8;

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

  const senderSignal = buildSenderSignal(messages);

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

  return {
    eligibleThreadCount,
    ...senderSignal,
    gmailLabels: rank(gmailLabels, TOP_TERMS),
  };
}

type SampledMessage = { senderEmail: string; senderName: string | null; subject: string | null };

/**
 * Pure aggregation of the body-free sender/subject signal from sampled messages.
 * Sender domains whose mail is overwhelmingly no-reply machine traffic
 * (account/security notifications, service updates) are dropped from every
 * folder-defining signal so taxonomy generation never mints a folder for a
 * single automated sender. This is intentionally more aggressive than the
 * routing-time automated-mail filter: suppressing a sender here only withholds a
 * folder, it never misfiles an email.
 */
export function buildSenderSignal(
  messages: SampledMessage[],
): Pick<InboxProfile, "senderDomains" | "senderNames" | "subjectKeywords" | "senderClusters"> {
  // First pass: tally each domain's total vs. no-reply messages to find the
  // "noise" domains. A domain that mixes human and no-reply mail (a real contact
  // at a company that also sends alerts) stays below the threshold and is kept.
  const domainTotal = new Map<string, number>();
  const domainNoReply = new Map<string, number>();
  for (const m of messages) {
    const domain = emailDomain(m.senderEmail);
    if (!domain) continue;
    domainTotal.set(domain, (domainTotal.get(domain) ?? 0) + 1);
    if (senderIsNoReply(m.senderEmail)) {
      domainNoReply.set(domain, (domainNoReply.get(domain) ?? 0) + 1);
    }
  }
  const noiseDomains = new Set<string>();
  for (const [domain, total] of domainTotal) {
    if ((domainNoReply.get(domain) ?? 0) / total >= NOREPLY_DOMAIN_SHARE) {
      noiseDomains.add(domain);
    }
  }

  // Second pass: accumulate the signal, skipping messages from noise domains so
  // their domain, name, and subject keywords never define a folder.
  const domains = new Map<string, number>();
  const names = new Map<string, number>();
  const keywords = new Map<string, number>();
  const perDomainKeywords = new Map<string, Map<string, number>>();
  for (const m of messages) {
    const domain = emailDomain(m.senderEmail);
    if (domain && noiseDomains.has(domain)) continue;
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

  const topDomains = rank(domains, CLUSTER_DOMAIN_LIMIT);
  const senderClusters: SenderCluster[] = topDomains.map((d) => ({
    label: d.term,
    count: d.count,
    keywords: rank(perDomainKeywords.get(d.term) ?? new Map(), CLUSTER_KEYWORD_LIMIT, MIN_KEYWORD_COUNT),
  }));

  return {
    senderDomains: rank(domains, TOP_TERMS),
    senderNames: rank(names, TOP_TERMS),
    subjectKeywords: rank(keywords, TOP_TERMS, MIN_KEYWORD_COUNT),
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
export async function runGenerateTaxonomyJob(
  workspaceId: string,
  locale?: string,
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
  const connection = await db.gmailConnection.findUnique({
    where: { workspaceId },
    select: { gmailAddress: true },
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
  const recordWindow = connection ? meterWindowStart(now) : null;
  const enforceTaxonomy = config.billing.enforceTaxonomyQuota;
  const genWindowStart = enforceTaxonomy ? recordWindow : null;
  const genInWindow =
    connection && enforceTaxonomy && recordWindow
      ? await getMeterUsed(inboxKeyFor(connection.gmailAddress), "TAXONOMY_GEN", recordWindow)
      : 0;
  const genPlan = connection
    ? (await getInboxPlanCeiling(connection.gmailAddress)).plan
    : workspace.plan;

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

  // Count this generation against the reset-immune, inbox-pooled backstop meter.
  // Always recorded (even when enforcement is off) for observability.
  // (The delta-gate + cooldown fields below stay on the state row.)
  if (connection && recordWindow) {
    await recordMeterUsage({
      inboxKey: inboxKeyFor(connection.gmailAddress),
      kind: "TAXONOMY_GEN",
      windowStart: recordWindow,
      delta: 1,
      sizedForPlan: genPlan,
    });
  }

  await setState(workspaceId, {
    status: "READY",
    proposal: result.file as unknown as object,
    matchedTemplateId: template.id,
    lastGeneratedAt: now,
    threadCountAtLastGen: profile.eligibleThreadCount,
    lastOutcome: "SUCCESS",
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
    (job) => runGenerateTaxonomyJob(job.data.workspaceId, job.data.locale),
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
