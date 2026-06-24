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
 *   pnpm --filter @amarnai/ai benchmark:constants
 *
 * Requires the matching per-model fixture to be current:
 *   pnpm --filter @amarnai/ai seed:embeddings            (qwen3, default)
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
  type TestEmail,
} from "./fixtures/sorting-fixtures.js";
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
  { name: "deep-d3", nodes: ALL_NODES_D3, edges: ALL_EDGES_D3, emails: TEST_EMAILS_D3 },
  { name: "failure-modes", nodes: ALL_NODES_FM, edges: ALL_EDGES_FM, emails: TEST_EMAILS_FM },
];

const ALL_EMAILS: TestEmail[] = DATASETS.flatMap((d) => d.emails);

// Opt-in: run the scale-invariant decision path (B-lite + folded-in A). The LLM
// is stubbed here, so scale-invariant mode shows MORE review outcomes (every
// escalation a real LLM would resolve counts as review/0). Read it by wrong-route
// count and escalation rate, not raw score; the reasoning benchmark (live LLM)
// measures end-to-end accuracy.
const SCALE_INVARIANT = process.env["BENCHMARK_SCALE_INVARIANT"] === "1";

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

const GRID = {
  thetaMin:           [0.15, 0.20, 0.25, 0.30],
  lambdaDepthDecay:   [0.85, 0.90, 0.95, 1.00],
  softmaxTemperature: [0.05, 0.10, 0.15, 0.20],
  thetaSpread:        [0.15, 0.20, 0.25, 0.30],
  thetaDescent:       [0.00, 0.10, 0.20, 0.30],
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
        { ...config, scaleInvariant: SCALE_INVARIANT }
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

function isCurrentDefaults(c: Config): boolean {
  return (
    c.thetaMin === THETA_MIN &&
    c.lambdaDepthDecay === LAMBDA_DEPTH_DECAY &&
    c.softmaxTemperature === SOFTMAX_TEMPERATURE &&
    c.thetaSpread === THETA_SPREAD &&
    c.thetaDescent === THETA_DESCENT &&
    c.crossBranchMargin === CROSS_BRANCH_MARGIN
  );
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

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const model = process.env["BENCHMARK_EMBEDDING_MODEL"] ?? DEFAULT_FIXTURE_MODEL;
  const embeddingProvider = makeRealEmbeddingProvider(model);
  const configs = [...generateCombinations()];
  const total = configs.length;

  console.log(`\nEmbedding model: ${embeddingProvider.modelName}`);
  console.log(`Decision mode:   ${SCALE_INVARIANT ? "scale-invariant (B-lite + folded A)" : "legacy absolute thresholds"}`);
  console.log(
    `Datasets: ${DATASETS.map((d) => `${d.name} (${d.emails.length})`).join(", ")} ` +
    `= ${ALL_EMAILS.length} emails`
  );
  console.log(`\nGrid search: ${total.toLocaleString()} combinations × ${ALL_EMAILS.length} fixtures\n`);
  process.stdout.write("Progress: [");

  const DOT_INTERVAL = Math.max(1, Math.floor(total / 50));
  const results: BenchmarkResult[] = [];

  for (let i = 0; i < configs.length; i++) {
    if (i % DOT_INTERVAL === 0) process.stdout.write(".");
    const result = await runConfig(configs[i]!, embeddingProvider, DATASETS);
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
    ALL_EMAILS.filter((e) => e.difficulty === "easy").length * POINTS.correctEasy +
    ALL_EMAILS.filter((e) => e.difficulty !== "easy").length * POINTS.correctOther;

  console.log(`Max achievable score: ${maxScore}\n`);
  console.log(
    "Rank   Score  thetaMin  lambda  temp   spread  delta  cross  LLM%"
  );
  console.log("─".repeat(72));

  for (let i = 0; i < Math.min(15, results.length); i++) {
    const { config: c, score, details } = results[i]!;
    const llmPct = Math.round((details.filter((d) => d.llmCalled).length / ALL_EMAILS.length) * 100);
    const mark = isCurrentDefaults(c) ? "  ← current defaults" : "";
    console.log(
      `${String(i + 1).padStart(4)}  ${String(score.toFixed(1)).padStart(6)}` +
      `  ${fmt(c.thetaMin)}  ${fmt(c.lambdaDepthDecay)}  ${fmt(c.softmaxTemperature)}` +
      `  ${fmt(c.thetaSpread)}  ${fmt(c.thetaDescent)}  ${fmt(c.crossBranchMargin)}` +
      `  ${String(llmPct).padStart(3)}%${mark}`
    );
  }

  // ── Current defaults rank ────────────────────────────────────────────────────

  const currentDefaultsKey = configKey({
    thetaMin: THETA_MIN,
    lambdaDepthDecay: LAMBDA_DEPTH_DECAY,
    softmaxTemperature: SOFTMAX_TEMPERATURE,
    thetaSpread: THETA_SPREAD,
    thetaDescent: THETA_DESCENT,
    crossBranchMargin: CROSS_BRANCH_MARGIN,
  });
  const currentRank = results.findIndex((r) => configKey(r.config) === currentDefaultsKey);
  console.log(
    `\nCurrent defaults → rank ${currentRank + 1} / ${total.toLocaleString()} ` +
    `(score: ${results[currentRank]?.score.toFixed(1)})`
  );

  // ── WS3 metrics for the CURRENT defaults ────────────────────────────────────
  //
  // Report metrics on the current shipped constants (not the grid winner): this
  // is the configuration actually running, so its per-source accuracy, escalation
  // and fallback rates, and confusion are what we judge changes against. The
  // failure-mode fixtures should appear here as non-correct under today's values.

  const current = results[currentRank]!;
  console.log(`\n══ Current-defaults diagnostics (model: ${embeddingProvider.modelName}) ══`);
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
