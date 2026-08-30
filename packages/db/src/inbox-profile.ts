import { senderIsNoReply } from "@aziru/ai";
import {
  emailDomain,
  type InboxProfile,
  type ProfileTerm,
  type SenderCluster,
} from "@aziru/shared";
import { db } from "./client.js";
import { eligibleThreadWhere } from "./eligible-threads.js";

// Body-free inbox profiling shared by taxonomy generation (worker) and the
// template-recommendation endpoint (api). Reads only persisted metadata.

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
    // Labels are a secondary signal — never fail profiling over them.
    console.error(`[inbox-profile] label aggregation failed for ${workspaceId}:`, err);
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
