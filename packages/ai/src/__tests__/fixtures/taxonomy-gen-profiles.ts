import { recurringDomainCount, type InboxProfile, type ProfileTerm, type SenderCluster } from "@amarnai/shared";

export { recurringDomainCount };

// Synthetic, body-free inbox profiles for the taxonomy-generation tuning harness
// (benchmark-taxonomy-gen.ts). These mirror the shape the worker feeds the LLM
// AFTER no-reply-domain suppression (see buildSenderSignal in the worker), so a
// profile here only contains folder-defining signal — pure machine senders have
// already been dropped upstream and never appear.
//
// The fixtures span the "variety" axis the bands are meant to track:
//   - floor    : exactly the eligibility minimum (8 domains / 40 threads)
//   - medium   : a typical knowledge-worker inbox (~18 domains)
//   - broad    : a power inbox that saturates the cluster cap (12)
//   - inflated : high distinct-domain count but mostly one-off senders — the
//                adversarial case for choosing recurring-domain count as the
//                variety measure over raw distinct-domain count
//
// They are intentionally synthetic (not anonymized real mail) so the variety
// axis is controlled and there is no privacy surface.

const t = (term: string, count: number): ProfileTerm => ({ term, count });
const cluster = (label: string, count: number, keywords: Array<[string, number]>): SenderCluster => ({
  label,
  count,
  keywords: keywords.map(([term, c]) => t(term, c)),
});

export interface ProfileFixture {
  name: string;
  /** One-line description of the inbox this models. */
  note: string;
  profile: InboxProfile;
}

// ─── floor: just over the eligibility threshold ───────────────────────────────
// GENERATION_MIN_ELIGIBLE_THREADS = 40, GENERATION_MIN_SENDER_DOMAINS = 8.
// A solo professional whose inbox barely qualifies. At 8 distinct domains a
// taxonomy of 8-12 leaves would be ~one folder per sender, so the "right" answer
// here is a compact tree (≈5-8 leaves).
const FLOOR: ProfileFixture = {
  name: "floor",
  note: "Solo professional at the eligibility minimum — 8 domains, 40 threads",
  profile: {
    eligibleThreadCount: 40,
    senderDomains: [
      t("acme-corp.com", 8),
      t("university.edu", 6),
      t("recruiter-firm.com", 5),
      t("github.com", 5),
      t("linkedin.com", 4),
      t("substack.com", 4),
      t("airbnb.com", 4),
      t("chase.com", 4),
    ],
    senderNames: [
      t("Acme Projects", 8),
      t("Dr. Helen Pratt", 6),
      t("TalentBridge Recruiting", 5),
      t("GitHub", 5),
      t("LinkedIn", 4),
    ],
    subjectKeywords: [
      t("project", 7),
      t("invoice", 4),
      t("interview", 4),
      t("pull", 3),
      t("request", 3),
      t("course", 3),
      t("statement", 3),
      t("reservation", 2),
    ],
    gmailLabels: [t("Work", 9), t("Finance", 4)],
    senderClusters: [
      cluster("acme-corp.com", 8, [["project", 5], ["invoice", 3]]),
      cluster("university.edu", 6, [["course", 3], ["lecture", 2]]),
      cluster("recruiter-firm.com", 5, [["interview", 4], ["role", 2]]),
      cluster("github.com", 5, [["pull", 3], ["request", 3]]),
      cluster("chase.com", 4, [["statement", 3]]),
    ],
  },
};

// ─── medium: typical knowledge-worker inbox ──────────────────────────────────
// ~18 distinct domains, most recurring; clear themes across work, finance,
// newsletters, travel, shopping. Target band ≈8-11 leaves.
const MEDIUM: ProfileFixture = {
  name: "medium",
  note: "Knowledge worker — ~18 domains across work, finance, news, travel, shopping",
  profile: {
    eligibleThreadCount: 650,
    senderDomains: [
      t("bigco.com", 120),
      t("notion.so", 48),
      t("figma.com", 40),
      t("slack.com", 38),
      t("stripe.com", 30),
      t("chase.com", 28),
      t("amazon.com", 26),
      t("substack.com", 24),
      t("nytimes.com", 22),
      t("united.com", 18),
      t("airbnb.com", 16),
      t("doordash.com", 14),
      t("calendly.com", 12),
      t("zoom.us", 11),
      t("dropbox.com", 9),
      t("medium.com", 8),
      t("eventbrite.com", 6),
      t("apple.com", 5),
    ],
    senderNames: [
      t("BigCo Team", 120),
      t("Notion", 48),
      t("Figma", 40),
      t("Slack", 38),
      t("The New York Times", 22),
    ],
    subjectKeywords: [
      t("project", 60),
      t("review", 44),
      t("meeting", 40),
      t("invoice", 34),
      t("payment", 30),
      t("order", 28),
      t("newsletter", 24),
      t("flight", 18),
      t("booking", 16),
      t("design", 30),
      t("comment", 26),
      t("deploy", 14),
      t("digest", 12),
    ],
    gmailLabels: [t("Work", 220), t("Finance", 58), t("Newsletters", 54), t("Travel", 34)],
    senderClusters: [
      cluster("bigco.com", 120, [["project", 40], ["meeting", 30], ["review", 20]]),
      cluster("notion.so", 48, [["comment", 18], ["page", 12]]),
      cluster("figma.com", 40, [["design", 20], ["comment", 14]]),
      cluster("slack.com", 38, [["message", 16], ["channel", 10]]),
      cluster("stripe.com", 30, [["payment", 18], ["invoice", 10]]),
      cluster("chase.com", 28, [["statement", 14], ["payment", 10]]),
      cluster("amazon.com", 26, [["order", 18], ["shipped", 8]]),
      cluster("substack.com", 24, [["newsletter", 14], ["digest", 8]]),
      cluster("nytimes.com", 22, [["briefing", 12], ["digest", 6]]),
      cluster("united.com", 18, [["flight", 12], ["boarding", 4]]),
      cluster("airbnb.com", 16, [["booking", 10], ["reservation", 4]]),
      cluster("doordash.com", 14, [["order", 10], ["delivery", 4]]),
    ],
  },
};

// ─── broad: power inbox saturating the cluster cap ────────────────────────────
// ~45 distinct domains, dense keywords, clusters fill CLUSTER_DOMAIN_LIMIT (12).
// This is the case the upper band/ceiling decision turns on. Target ≈11-14 leaves
// unless CLUSTER_DOMAIN_LIMIT is raised to surface more supported themes.
const BROAD: ProfileFixture = {
  name: "broad",
  note: "Power user — 45 domains, dense themes, saturates the 12-cluster cap",
  profile: {
    eligibleThreadCount: 3000,
    senderDomains: [
      t("bigco.com", 280),
      t("github.com", 190),
      t("notion.so", 150),
      t("figma.com", 130),
      t("slack.com", 120),
      t("linear.app", 110),
      t("stripe.com", 95),
      t("chase.com", 88),
      t("amex.com", 70),
      t("amazon.com", 82),
      t("substack.com", 76),
      t("nytimes.com", 64),
      t("united.com", 58),
      t("airbnb.com", 52),
      t("booking.com", 44),
      t("doordash.com", 40),
      t("instacart.com", 34),
      t("calendly.com", 30),
      t("zoom.us", 28),
      t("dropbox.com", 26),
      t("medium.com", 24),
      t("eventbrite.com", 22),
      t("meetup.com", 20),
      t("apple.com", 18),
      t("google.com", 17),
      t("spotify.com", 16),
      t("netflix.com", 15),
      t("coursera.org", 14),
      t("udemy.com", 13),
      t("producthunt.com", 12),
      t("hackernews.com", 11),
      t("reddit.com", 10),
      t("twitch.tv", 9),
      t("patreon.com", 8),
      t("kickstarter.com", 7),
      t("strava.com", 6),
      t("fitbit.com", 6),
      t("audible.com", 5),
      t("goodreads.com", 5),
      t("wsj.com", 5),
      t("economist.com", 4),
      t("ft.com", 4),
      t("bloomberg.com", 4),
      t("techcrunch.com", 4),
      t("theverge.com", 4),
    ],
    senderNames: [
      t("BigCo Team", 280),
      t("GitHub", 190),
      t("Notion", 150),
      t("Figma", 130),
      t("Linear", 110),
    ],
    subjectKeywords: [
      t("pull", 120),
      t("request", 110),
      t("project", 100),
      t("review", 92),
      t("issue", 80),
      t("meeting", 78),
      t("payment", 70),
      t("invoice", 64),
      t("order", 60),
      t("newsletter", 56),
      t("digest", 50),
      t("flight", 44),
      t("booking", 40),
      t("design", 60),
      t("comment", 54),
      t("deploy", 48),
      t("statement", 40),
      t("subscription", 36),
      t("event", 32),
      t("ticket", 28),
    ],
    gmailLabels: [
      t("Work", 700),
      t("Code", 300),
      t("Finance", 250),
      t("Newsletters", 200),
      t("Travel", 150),
      t("Shopping", 120),
    ],
    senderClusters: [
      cluster("bigco.com", 280, [["project", 90], ["meeting", 60], ["review", 50]]),
      cluster("github.com", 190, [["pull", 90], ["request", 80], ["issue", 40]]),
      cluster("notion.so", 150, [["comment", 50], ["page", 30]]),
      cluster("figma.com", 130, [["design", 60], ["comment", 40]]),
      cluster("slack.com", 120, [["message", 50], ["channel", 30]]),
      cluster("linear.app", 110, [["issue", 60], ["cycle", 20]]),
      cluster("stripe.com", 95, [["payment", 50], ["invoice", 30]]),
      cluster("chase.com", 88, [["statement", 40], ["payment", 30]]),
      cluster("amazon.com", 82, [["order", 50], ["shipped", 20]]),
      cluster("substack.com", 76, [["newsletter", 40], ["digest", 24]]),
      cluster("nytimes.com", 64, [["briefing", 30], ["digest", 18]]),
      cluster("united.com", 58, [["flight", 36], ["boarding", 12]]),
    ],
  },
};

// ─── inflated: many one-off senders, few recurring ────────────────────────────
// 40 distinct domains but only ~6 recur (count >= 2); the rest are single-shot
// senders that inflate raw domain count without adding a real recurring theme.
// The "right" answer tracks the recurring core (≈5-8 leaves), NOT 14 — so this
// fixture is what distinguishes a recurring-domain variety measure from a naive
// distinct-domain count.
const ONE_OFF_DOMAINS: ProfileTerm[] = Array.from({ length: 34 }, (_, i) => t(`oneoff-${i + 1}.com`, 1));
const INFLATED: ProfileFixture = {
  name: "inflated",
  note: "High distinct-domain count (40) but only ~6 recurring senders — the rest are one-offs",
  profile: {
    eligibleThreadCount: 500,
    senderDomains: [
      t("acme-corp.com", 90),
      t("github.com", 70),
      t("stripe.com", 55),
      t("chase.com", 40),
      t("substack.com", 30),
      t("amazon.com", 25),
      ...ONE_OFF_DOMAINS,
    ],
    senderNames: [t("Acme Projects", 90), t("GitHub", 70)],
    subjectKeywords: [
      t("project", 60),
      t("pull", 40),
      t("payment", 35),
      t("statement", 25),
      t("newsletter", 22),
      t("order", 18),
    ],
    gmailLabels: [t("Work", 160), t("Finance", 95)],
    senderClusters: [
      cluster("acme-corp.com", 90, [["project", 40], ["review", 20]]),
      cluster("github.com", 70, [["pull", 40], ["issue", 20]]),
      cluster("stripe.com", 55, [["payment", 30], ["invoice", 18]]),
      cluster("chase.com", 40, [["statement", 24]]),
      cluster("substack.com", 30, [["newsletter", 18], ["digest", 8]]),
      cluster("amazon.com", 25, [["order", 16], ["shipped", 6]]),
    ],
  },
};

export const PROFILE_FIXTURES: ProfileFixture[] = [FLOOR, MEDIUM, BROAD, INFLATED];

// ─── Leaf signal-support metric ───────────────────────────────────────────────
// A leaf is "signal-supported" when its name/description shares a token with the
// inbox signal (cluster keywords, domain roots, subject keywords, sender names,
// labels). Generic catch-all buckets ("Updates / Other") legitimately score
// unsupported — that is expected, not a defect. The metric distinguishes folders
// the inbox justifies from invented filler, which is what the bands must avoid.

const SUPPORT_STOP_WORDS = new Set([
  "the", "and", "for", "with", "from", "your", "you", "are", "our", "this",
  "that", "all", "any", "com", "net", "org", "www", "mail", "email", "inbox",
  "other", "others", "misc", "general", "stuff", "things",
]);

function supportTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !SUPPORT_STOP_WORDS.has(w));
}

/** Union of signal tokens the inbox actually carries. */
export function profileSignalTokens(profile: InboxProfile): Set<string> {
  const tokens = new Set<string>();
  const add = (term: string) => {
    for (const tok of supportTokens(term)) tokens.add(tok);
  };
  for (const d of profile.senderDomains) add(d.term.split(".")[0] ?? d.term);
  for (const n of profile.senderNames) add(n.term);
  for (const k of profile.subjectKeywords) add(k.term);
  for (const l of profile.gmailLabels) add(l.term);
  for (const c of profile.senderClusters) {
    add(c.label.split(".")[0] ?? c.label);
    for (const k of c.keywords) add(k.term);
  }
  return tokens;
}

/** True when a folder name/description overlaps the inbox signal. */
export function leafIsSupported(
  name: string,
  description: string | null,
  signal: Set<string>,
): boolean {
  const toks = [...supportTokens(name), ...(description ? supportTokens(description) : [])];
  return toks.some((tok) => signal.has(tok));
}
