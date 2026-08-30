/**
 * Grid-search benchmark for sorter threshold constants.
 *
 * Sweeps 4,096 combinations of the six tunable constants in sorter.ts against
 * the labeled email fixtures across MULTIPLE taxonomy shapes (flat depth-1,
 * deep depth-3, and a domain-neutral failure-mode taxonomy) using pre-computed
 * real embeddings. The LLM is stubbed (always returns needsHumanReview) so
 * scores reflect the embedding phase only.
 *
 * The embedding model is selectable so constants can be judged on the model
 * actually deployed (Gemini) rather than only the offline default (qwen3):
 *   BENCHMARK_EMBEDDING_MODEL=gemini-embedding-001@768 pnpm … benchmark:constants
 *
 * Run:
 *   pnpm --filter @aziru/ai benchmark:constants
 *
 * Requires the matching per-model fixture to be current:
 *   pnpm --filter @aziru/ai seed:embeddings            (qwen3, default)
 *   EMBEDDING_PROVIDER=frontier FRONTIER_EMBEDDING_PROVIDER=gemini … seed:embeddings
 */
import { sortThreadByEmbedding } from "../embedding/sorter.js";
import {
  THETA_MIN,
  LAMBDA_DEPTH_DECAY,
  SOFTMAX_TEMPERATURE,
  THETA_SPREAD,
  THETA_DESCENT,
  CROSS_BRANCH_MARGIN,
  CENTERED_ROUTING_CONFIG,
} from "../embedding/sorter.js";
import {
  makeRealEmbeddingProvider,
  DEFAULT_FIXTURE_MODEL,
} from "./fixtures/real-embedding-table.js";
import {
  ALL_NODES,
  ALL_EDGES,
  TEST_EMAILS,
  ALL_NODES_D3,
  ALL_EDGES_D3,
  TEST_EMAILS_D3,
  ALL_NODES_FM,
  ALL_EDGES_FM,
  TEST_EMAILS_FM,
  TEST_EMAILS_FWD,
  type TestEmail,
} from "./fixtures/sorting-fixtures.js";
import { ML_FLAT, ML_D3 } from "./fixtures/multilingual/index.js";
import type { AIProvider, TaxonomyNodeInput, TaxonomyEdgeInput } from "../types.js";

// ─── Datasets ─────────────────────────────────────────────────────────────────
//
// Each dataset is scored against its OWN taxonomy. Mixing shapes (flat, deep,
// single-child-leaf) is what surfaces structural failures a flat-only benchmark
// cannot see.

type Dataset = {
  name: string;
  nodes: TaxonomyNodeInput[];
  edges: TaxonomyEdgeInput[];
  emails: TestEmail[];
};

const DATASETS: Dataset[] = [
  { name: "flat-d1", nodes: ALL_NODES, edges: ALL_EDGES, emails: TEST_EMAILS },
  // B6 multilingual sets (16 locales), scored as their own slices so cross-lingual
  // routing is visible separately. ml-flat routes against the flat taxonomy;
  // ml-d3 against the depth-3 taxonomy.
  { name: "ml-flat", nodes: ALL_NODES, edges: ALL_EDGES, emails: ML_FLAT },
  { name: "deep-d3", nodes: ALL_NODES_D3, edges: ALL_EDGES_D3, emails: TEST_EMAILS_D3 },
  { name: "ml-d3", nodes: ALL_NODES_D3, edges: ALL_EDGES_D3, emails: ML_D3 },
  // Forwarded emails + reply threads (positional reply-tail rule, flat taxonomy).
  { name: "fwd", nodes: ALL_NODES, edges: ALL_EDGES, emails: TEST_EMAILS_FWD },
  { name: "failure-modes", nodes: ALL_NODES_FM, edges: ALL_EDGES_FM, emails: TEST_EMAILS_FM },
];

// Train/test split: the grid search only sees "tune" fixtures; "holdout" fixtures
// are scored once at the chosen config so the reported holdout accuracy is not
// contaminated by the tuning it drove. Fixtures with no split (legacy) are "tune".
const isHoldout = (e: TestEmail): boolean => e.split === "holdout";
const filterDatasets = (keep: (e: TestEmail) => boolean): Dataset[] =>
  DATASETS.map((d) => ({ ...d, emails: d.emails.filter(keep) })).filter((d) => d.emails.length > 0);
const TUNE_DATASETS: Dataset[] = filterDatasets((e) => !isHoldout(e));
const HOLDOUT_DATASETS: Dataset[] = filterDatasets(isHoldout);

const ALL_EMAILS: TestEmail[] = DATASETS.flatMap((d) => d.emails);
const TUNE_EMAILS: TestEmail[] = TUNE_DATASETS.flatMap((d) => d.emails);
const HOLDOUT_EMAILS: TestEmail[] = HOLDOUT_DATASETS.flatMap((d) => d.emails);

// Opt-in: run the scale-invariant decision path (B-lite + folded-in A). The LLM
// is stubbed here, so scale-invariant mode shows MORE review outcomes (every
// escalation a real LLM would resolve counts as review/0). Read it by wrong-route
// count and escalation rate, not raw score; the reasoning benchmark (live LLM)
// measures end-to-end accuracy.
const SCALE_INVARIANT = process.env["BENCHMARK_SCALE_INVARIANT"] === "1";
// Opt-in mean-centering (anisotropy correction). Production sets meanCenter: true;
// the benchmark mirrors it so constants are tuned for the deployed configuration.
const MEAN_CENTER = process.env["BENCHMARK_MEAN_CENTER"] === "1";

/** Node id → display name, across every dataset, for readable confusion output. */
const NODE_NAME = new Map<string, string>(
  DATASETS.flatMap((d) => d.nodes.map((n) => [n.id, n.name] as const))
);
const nodeName = (id: string | null): string => (id == null ? "null" : NODE_NAME.get(id) ?? id);

// ─── LLM stub ─────────────────────────────────────────────────────────────────

const BASE_STUB_LLM: AIProvider = {
  providerName: "stub",
  modelName: "stub-llm",
  async chat() {
    return JSON.stringify({
      selectedNodeId: null,
      confidence: 0,
      explanation: "LLM stubbed for benchmark",
      needsHumanReview: true,
    });
  },
};

// ─── Search grid ──────────────────────────────────────────────────────────────

// thetaMin/thetaDescent ranges span both the raw-cosine scale (~0.7-0.9, where
// the legacy non-centered defaults live) and the mean-centered scale (~0.05-0.4),
// so the same grid can tune either configuration. Mean-centering compresses the
// absolute floor: correct nodes land at centered subtree scores ~0.17-0.38, so a
// thetaMin around 0.05-0.13 is needed to admit them without admitting noise.
const GRID = {
  thetaMin:           [0.05, 0.10, 0.13, 0.15],
  lambdaDepthDecay:   [0.85, 0.90, 0.95, 1.00],
  softmaxTemperature: [0.05, 0.10, 0.15, 0.20],
  thetaSpread:        [0.10, 0.15, 0.20, 0.25],
  thetaDescent:       [0.00, 0.05, 0.10, 0.20],
  crossBranchMargin:  [0.05, 0.08, 0.10, 0.15],
} as const;

// ─── Scoring ──────────────────────────────────────────────────────────────────
//
// Easy fixtures must be routed correctly. Human review is penalised.
// Medium/hard fixtures: correct is best, human review is acceptable (0),
// wrong routing is always penalised.
// LLM escalation: small penalty to reward configurations that avoid it.

const POINTS = {
  correctEasy:      10,
  correctOther:      5,
  reviewAllowed:     0,   // allowNeedsHumanReview && needsHumanReview
  reviewDenied:     -5,   // !allowNeedsHumanReview && needsHumanReview
  wrongRouting:    -20,
  llmEscalation:   -0.2,
} as const;

// ─── Types ────────────────────────────────────────────────────────────────────

type Config = {
  thetaMin: number;
  lambdaDepthDecay: number;
  softmaxTemperature: number;
  thetaSpread: number;
  thetaDescent: number;
  crossBranchMargin: number;
};

/**
 * The shipped config for the active mode: under mean-centering, production runs
 * CENTERED_ROUTING_CONFIG (not the raw THETA_* defaults), so the benchmark's
 * "reference" diagnostics and holdout numbers reflect what actually ships.
 */
const REFERENCE_CONFIG: Config = MEAN_CENTER
  ? {
      thetaMin: CENTERED_ROUTING_CONFIG.thetaMin,
      lambdaDepthDecay: CENTERED_ROUTING_CONFIG.lambdaDepthDecay,
      softmaxTemperature: CENTERED_ROUTING_CONFIG.softmaxTemperature,
      thetaSpread: CENTERED_ROUTING_CONFIG.thetaSpread,
      thetaDescent: CENTERED_ROUTING_CONFIG.thetaDescent,
      crossBranchMargin: CENTERED_ROUTING_CONFIG.crossBranchMargin,
    }
  : {
      thetaMin: THETA_MIN,
      lambdaDepthDecay: LAMBDA_DEPTH_DECAY,
      softmaxTemperature: SOFTMAX_TEMPERATURE,
      thetaSpread: THETA_SPREAD,
      thetaDescent: THETA_DESCENT,
      crossBranchMargin: CROSS_BRANCH_MARGIN,
    };

type EmailOutcome = "correct" | "review_allowed" | "review_denied" | "wrong";

type EmailDetail = {
  dataset: string;
  emailId: string;
  difficulty: TestEmail["difficulty"];
  expected: string;
  got: string | null;
  needsHumanReview: boolean;
  llmCalled: boolean;
  /** From EmbeddingSortResult — which path decided the route. */
  decisionSource: string;
  outcome: EmailOutcome;
  points: number;
};

type BenchmarkResult = {
  config: Config;
  score: number;
  details: EmailDetail[];
};

// ─── Grid generator ───────────────────────────────────────────────────────────

function* generateCombinations(): Generator<Config> {
  for (const thetaMin of GRID.thetaMin)
    for (const lambdaDepthDecay of GRID.lambdaDepthDecay)
      for (const softmaxTemperature of GRID.softmaxTemperature)
        for (const thetaSpread of GRID.thetaSpread)
          for (const thetaDescent of GRID.thetaDescent)
            for (const crossBranchMargin of GRID.crossBranchMargin)
              yield { thetaMin, lambdaDepthDecay, softmaxTemperature, thetaSpread, thetaDescent, crossBranchMargin };
}

// ─── Single-config runner ─────────────────────────────────────────────────────

async function runConfig(
  config: Config,
  embeddingProvider: ReturnType<typeof makeRealEmbeddingProvider>,
  datasets: Dataset[]
): Promise<BenchmarkResult> {
  let totalScore = 0;
  const details: EmailDetail[] = [];

  for (const dataset of datasets) {
    for (const email of dataset.emails) {
      let llmCalled = false;

      // Per-email LLM spy — wraps the stub to track call counts
      const trackingLlm: AIProvider = {
        ...BASE_STUB_LLM,
        async chat(...args) {
          llmCalled = true;
          return BASE_STUB_LLM.chat(...args);
        },
      };

      const result = await sortThreadByEmbedding(
        embeddingProvider,
        trackingLlm,
        dataset.nodes,
        dataset.edges,
        email.messages,
        { ...config, scaleInvariant: SCALE_INVARIANT, meanCenter: MEAN_CENTER }
      );

      // LLM escalation penalty
      if (llmCalled) totalScore += POINTS.llmEscalation;

      // Outcome classification
      let outcome: EmailOutcome;
      let points: number;

      if (result.finalNodeId === email.expectedFinalNodeId) {
        outcome = "correct";
        points = email.difficulty === "easy" ? POINTS.correctEasy : POINTS.correctOther;
      } else if (result.needsHumanReview) {
        if (email.allowNeedsHumanReview) {
          outcome = "review_allowed";
          points = POINTS.reviewAllowed;
        } else {
          outcome = "review_denied";
          points = POINTS.reviewDenied;
        }
      } else {
        outcome = "wrong";
        points = POINTS.wrongRouting;
      }

      totalScore += points;
      details.push({
        dataset: dataset.name,
        emailId: email.id,
        difficulty: email.difficulty,
        expected: email.expectedFinalNodeId,
        got: result.finalNodeId,
        needsHumanReview: result.needsHumanReview,
        llmCalled,
        decisionSource: result.decisionSource,
        outcome,
        points,
      });
    }
  }

  return { config, score: totalScore, details };
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

function configKey(c: Config): string {
  return [c.thetaMin, c.lambdaDepthDecay, c.softmaxTemperature, c.thetaSpread, c.thetaDescent, c.crossBranchMargin].join(",");
}

function isReferenceConfig(c: Config): boolean {
  return configKey(c) === configKey(REFERENCE_CONFIG);
}

function fmt(n: number, width = 5): string {
  return n.toFixed(2).padStart(width);
}

function pct(n: number, d: number): string {
  return d === 0 ? "—" : `${Math.round((n / d) * 100)}%`;
}

function outcomeSymbol(o: EmailOutcome): string {
  switch (o) {
    case "correct":       return "✓";
    case "review_allowed": return "~";
    case "review_denied": return "!";
    case "wrong":         return "✗";
  }
}

// ─── WS3 metrics: decision-source / escalation / confusion ─────────────────────

/** Accuracy split by the path that decided the route. */
function printDecisionSourceBreakdown(details: EmailDetail[]): void {
  const sources = [...new Set(details.map((d) => d.decisionSource))].sort();
  console.log("\n── Accuracy by decision source ───────────────────────────────────────────");
  console.log("source            count  correct  review  wrong");
  console.log("─".repeat(54));
  for (const s of sources) {
    const rows = details.filter((d) => d.decisionSource === s);
    const correct = rows.filter((d) => d.outcome === "correct").length;
    const review = rows.filter((d) => d.outcome === "review_allowed" || d.outcome === "review_denied").length;
    const wrong = rows.filter((d) => d.outcome === "wrong").length;
    console.log(
      `${s.padEnd(16)}  ${String(rows.length).padStart(5)}  ${String(correct).padStart(7)}  ${String(review).padStart(6)}  ${String(wrong).padStart(5)}`
    );
  }
}

/** Per-dataset accuracy + escalation/fallback rates. */
function printDatasetBreakdown(details: EmailDetail[]): void {
  console.log("\n── Per-dataset outcomes ──────────────────────────────────────────────────");
  console.log("dataset         count  correct  escalated  fallback");
  console.log("─".repeat(56));
  for (const dataset of DATASETS) {
    const rows = details.filter((d) => d.dataset === dataset.name);
    const correct = rows.filter((d) => d.outcome === "correct").length;
    const escalated = rows.filter((d) => d.llmCalled).length;
    const fallback = rows.filter((d) => d.decisionSource === "inbox_fallback").length;
    console.log(
      `${dataset.name.padEnd(14)}  ${String(rows.length).padStart(5)}  ` +
      `${String(correct).padStart(7)} (${pct(correct, rows.length).padStart(4)})  ` +
      `${String(escalated).padStart(9)}  ${String(fallback).padStart(8)}`
    );
  }
}

/** Every non-correct outcome as expected → got, so misroutes are legible. */
function printConfusion(details: EmailDetail[]): void {
  const misses = details.filter((d) => d.outcome !== "correct");
  if (misses.length === 0) {
    console.log("\n── Confusion (non-correct) ───────────────────────────────────────────────");
    console.log("  none — every fixture routed correctly");
    return;
  }
  console.log("\n── Confusion (non-correct: expected → got) ───────────────────────────────");
  for (const d of misses) {
    const sym = outcomeSymbol(d.outcome);
    console.log(
      `  ${sym} [${d.dataset.padEnd(14)}] ${d.emailId.padEnd(32)} ` +
      `${nodeName(d.expected).padEnd(18)} → ${nodeName(d.got).padEnd(18)} (${d.decisionSource})`
    );
  }
}

// ─── Self-route metric (primary view: results up to escalation) ────────────────
//
// Scope: we judge the sorting results our code produces ON ITS OWN, up to and
// including the escalation decision. We do NOT grade the frontier LLM's answer on
// escalated threads (out of our control). So each thread falls into exactly one
// bucket:
//
//   committed  — we took responsibility for a destination node (needsHumanReview
//                false: embedding_auto or embedding_inbox). This is a self-route.
//   escalated  — handed to the LLM (llmCalled). A cost, not a result we claim.
//   declined   — we sent it to review WITHOUT escalating (quality-gate / failure
//                fallback: needsHumanReview && !llmCalled). A self-decision, but
//                not a route to a node.
//
// (In the stub, llmCalled ⟹ needsHumanReview, and a correct route ⟹ committed,
// so these three buckets partition every thread.)
//
// Reported numbers:
//   coverage      = committed / N            — how often we route to a node at all
//   precision     = correct  / committed     — quality of the routes we commit to
//   self-route    = correct  / N             — coverage × precision; the headline
//   escalation    = escalated / N            — the cost lever (B1 targets this)
//   decline       = declined  / N            — self-declined to review, no LLM
//
// This refines the plan's "coverage = 1 − escalation rate" by separating
// self-declines from escalations; both are "not a correct self-route", but they
// have different cost (a decline is free, an escalation is not).

type SelfRouteStats = {
  n: number;
  committed: number;
  correct: number;
  escalated: number;
  declined: number;
};

function selfRouteStats(details: EmailDetail[]): SelfRouteStats {
  return {
    n: details.length,
    committed: details.filter((d) => !d.needsHumanReview).length,
    correct: details.filter((d) => d.outcome === "correct").length,
    escalated: details.filter((d) => d.llmCalled).length,
    declined: details.filter((d) => d.needsHumanReview && !d.llmCalled).length,
  };
}

/** Headline self-route decomposition (overall + per dataset). The primary view. */
function printSelfRouteBreakdown(label: string, details: EmailDetail[]): void {
  const row = (name: string, s: SelfRouteStats): string =>
    `${name.padEnd(14)}  ${String(s.n).padStart(4)}  ` +
    `${pct(s.committed, s.n).padStart(5)}  ` +              // coverage
    `${pct(s.correct, s.committed).padStart(5)}  ` +        // precision
    `${pct(s.correct, s.n).padStart(5)}  ` +                // self-route
    `${pct(s.escalated, s.n).padStart(5)}  ` +              // escalation
    `${pct(s.declined, s.n).padStart(5)}`;                  // decline

  console.log(`\n── Self-route metric — ${label} (results before escalation) ──────────────`);
  console.log("slice            N  cover   prec   self    esc   decl");
  console.log("─".repeat(56));
  console.log(row("OVERALL", selfRouteStats(details)));
  for (const dataset of DATASETS) {
    const rows = details.filter((d) => d.dataset === dataset.name);
    if (rows.length === 0) continue;
    console.log(row(dataset.name, selfRouteStats(rows)));
  }
  console.log(
    "  cover=committed/N  prec=correct/committed  self=correct/N  esc=llm/N  decl=review-no-llm/N"
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const model = process.env["BENCHMARK_EMBEDDING_MODEL"] ?? DEFAULT_FIXTURE_MODEL;
  const embeddingProvider = makeRealEmbeddingProvider(model);
  const configs = [...generateCombinations()];
  const total = configs.length;

  console.log(`\nEmbedding model: ${embeddingProvider.modelName}`);
  console.log(`Decision mode:   ${SCALE_INVARIANT ? "scale-invariant (B-lite + folded A)" : "legacy absolute thresholds"}`);
  console.log(`Mean-centering:  ${MEAN_CENTER ? "on" : "off"}`);
  console.log(
    `Datasets: ${DATASETS.map((d) => `${d.name} (${d.emails.length})`).join(", ")} ` +
    `= ${ALL_EMAILS.length} emails`
  );
  console.log(`Split:    ${TUNE_EMAILS.length} tune (grid search) / ${HOLDOUT_EMAILS.length} holdout (scored at chosen config)`);
  console.log(`\nGrid search: ${total.toLocaleString()} combinations × ${TUNE_EMAILS.length} tune fixtures\n`);
  process.stdout.write("Progress: [");

  const DOT_INTERVAL = Math.max(1, Math.floor(total / 50));
  const results: BenchmarkResult[] = [];

  // Grid search sees ONLY the tune split.
  for (let i = 0; i < configs.length; i++) {
    if (i % DOT_INTERVAL === 0) process.stdout.write(".");
    const result = await runConfig(configs[i]!, embeddingProvider, TUNE_DATASETS);
    results.push(result);
  }

  console.log("]\n");

  // Sort by score descending, then by LLM escalation rate ascending as tiebreaker
  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aLlm = a.details.filter((d) => d.llmCalled).length;
    const bLlm = b.details.filter((d) => d.llmCalled).length;
    return aLlm - bLlm;
  });

  // ── Print top 15 ────────────────────────────────────────────────────────────

  const maxScore =
    TUNE_EMAILS.filter((e) => e.difficulty === "easy").length * POINTS.correctEasy +
    TUNE_EMAILS.filter((e) => e.difficulty !== "easy").length * POINTS.correctOther;

  console.log(`Max achievable tune score: ${maxScore}\n`);
  console.log(
    "Rank   Score  thetaMin  lambda  temp   spread  delta  cross  LLM%"
  );
  console.log("─".repeat(72));

  for (let i = 0; i < Math.min(15, results.length); i++) {
    const { config: c, score, details } = results[i]!;
    const llmPct = Math.round((details.filter((d) => d.llmCalled).length / Math.max(1, TUNE_EMAILS.length)) * 100);
    const mark = isReferenceConfig(c) ? "  ← shipped config" : "";
    console.log(
      `${String(i + 1).padStart(4)}  ${String(score.toFixed(1)).padStart(6)}` +
      `  ${fmt(c.thetaMin)}  ${fmt(c.lambdaDepthDecay)}  ${fmt(c.softmaxTemperature)}` +
      `  ${fmt(c.thetaSpread)}  ${fmt(c.thetaDescent)}  ${fmt(c.crossBranchMargin)}` +
      `  ${String(llmPct).padStart(3)}%${mark}`
    );
  }

  // ── Shipped (reference) config rank ─────────────────────────────────────────

  const referenceKey = configKey(REFERENCE_CONFIG);
  const currentRank = results.findIndex((r) => configKey(r.config) === referenceKey);
  console.log(
    `\nShipped config (${MEAN_CENTER ? "centered" : "raw"} defaults) → rank ${currentRank + 1} / ${total.toLocaleString()} ` +
    `(tune score: ${results[currentRank]?.score.toFixed(1)})`
  );

  // ── Diagnostics for the SHIPPED config (on tune) ────────────────────────────
  //
  // Report metrics on the configuration actually running (REFERENCE_CONFIG), not
  // the grid winner: its per-source accuracy, escalation and fallback rates, and
  // confusion are what we judge changes against.

  const current = results[currentRank]!;
  console.log(`\n══ Shipped-config diagnostics — TUNE (model: ${embeddingProvider.modelName}) ══`);
  printSelfRouteBreakdown("TUNE", current.details);
  printDatasetBreakdown(current.details);
  printDecisionSourceBreakdown(current.details);
  printConfusion(current.details);

  // ── Per-email breakdown for rank 1 ──────────────────────────────────────────

  console.log("\n── Per-email breakdown (rank 1) ─────────────────────────────────────────");
  const best = results[0]!;
  for (const d of best.details) {
    const llm = d.llmCalled ? " [LLM]" : "";
    const sym = outcomeSymbol(d.outcome);
    const pts = d.points >= 0 ? `+${d.points}` : String(d.points);
    console.log(
      `  ${sym} [${d.dataset.padEnd(14)}] ${d.emailId.padEnd(32)} → ${nodeName(d.got).padEnd(20)} (${pts})${llm}`
    );
  }

  // ── Holdout evaluation ──────────────────────────────────────────────────────
  //
  // Score the shipped config AND the grid winner on the holdout split (never seen
  // by the grid). If the winner's holdout accuracy is much lower than its tune
  // accuracy, the grid overfit; if shipped ≈ winner on holdout, the shipped
  // constants generalise. This is the number to trust.

  if (HOLDOUT_EMAILS.length > 0) {
    const shippedHoldout = await runConfig(REFERENCE_CONFIG, embeddingProvider, HOLDOUT_DATASETS);
    const winnerHoldout = await runConfig(best.config, embeddingProvider, HOLDOUT_DATASETS);
    const acc = (ds: BenchmarkResult): string => {
      const c = ds.details.filter((d) => d.outcome === "correct").length;
      return `${c}/${ds.details.length} (${pct(c, ds.details.length)})`;
    };
    console.log(`\n══ HOLDOUT (${HOLDOUT_EMAILS.length} fixtures, never seen by the grid) ══`);
    console.log(`  shipped config:   ${acc(shippedHoldout)} correct`);
    console.log(`  grid winner:      ${acc(winnerHoldout)} correct`);
    printSelfRouteBreakdown("HOLDOUT shipped", shippedHoldout.details);
    console.log("\n── Holdout per-dataset (shipped config) ──");
    printDatasetBreakdown(shippedHoldout.details);
    printConfusion(shippedHoldout.details);
  }

  // ── Recommendation ───────────────────────────────────────────────────────────

  console.log("\n── Recommendation ────────────────────────────────────────────────────────");
  if (currentRank === 0) {
    console.log("Current defaults are already rank 1. No change needed.\n");
  } else {
    const winner = best.config;
    console.log(`Best config on ${embeddingProvider.modelName}:`);
    console.log(`  THETA_MIN            = ${winner.thetaMin}`);
    console.log(`  LAMBDA_DEPTH_DECAY   = ${winner.lambdaDepthDecay}`);
    console.log(`  SOFTMAX_TEMPERATURE  = ${winner.softmaxTemperature}`);
    console.log(`  THETA_SPREAD         = ${winner.thetaSpread}`);
    console.log(`  THETA_DESCENT        = ${winner.thetaDescent}`);
    console.log(`  CROSS_BRANCH_MARGIN  = ${winner.crossBranchMargin}`);
    console.log(
      "\nNOTE: constants are embedding-model specific. Do not ship a value tuned on\n" +
      "one model without confirming it on the model in production (re-run with\n" +
      "BENCHMARK_EMBEDDING_MODEL set to each deployed model).\n"
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
