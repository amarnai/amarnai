/**
 * Grid-search benchmark for sorter threshold constants.
 *
 * Sweeps 4,096 combinations of the six tunable constants in sorter.ts
 * against all labeled email fixtures using pre-computed real embeddings.
 * The LLM is stubbed (always returns needsHumanReview) so scores reflect
 * the embedding phase only.
 *
 * Run:
 *   pnpm --filter @amarnai/ai benchmark:constants
 *
 * Requires embedding-vectors.json to be current:
 *   pnpm --filter @amarnai/ai seed:embeddings
 */
import { sortThreadByEmbedding } from "../embedding/sorter.js";
import {
  THETA_MIN,
  LAMBDA_DEPTH_DECAY,
  SOFTMAX_TEMPERATURE,
  THETA_SPREAD,
  DELTA_DESCENT_MARGIN,
  CROSS_BRANCH_MARGIN,
} from "../embedding/sorter.js";
import { makeRealEmbeddingProvider } from "./fixtures/real-embedding-table.js";
import { ALL_NODES, ALL_EDGES, TEST_EMAILS, type TestEmail } from "./fixtures/sorting-fixtures.js";
import type { AIProvider } from "../types.js";

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
  deltaDescentMargin: [0.02, 0.05, 0.08, 0.10],
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
  deltaDescentMargin: number;
  crossBranchMargin: number;
};

type EmailOutcome = "correct" | "review_allowed" | "review_denied" | "wrong";

type EmailDetail = {
  emailId: string;
  difficulty: TestEmail["difficulty"];
  expected: string;
  got: string | null;
  needsHumanReview: boolean;
  llmCalled: boolean;
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
          for (const deltaDescentMargin of GRID.deltaDescentMargin)
            for (const crossBranchMargin of GRID.crossBranchMargin)
              yield { thetaMin, lambdaDepthDecay, softmaxTemperature, thetaSpread, deltaDescentMargin, crossBranchMargin };
}

// ─── Single-config runner ─────────────────────────────────────────────────────

async function runConfig(
  config: Config,
  embeddingProvider: ReturnType<typeof makeRealEmbeddingProvider>,
  emails: TestEmail[]
): Promise<BenchmarkResult> {
  let totalScore = 0;
  const details: EmailDetail[] = [];

  for (const email of emails) {
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
      ALL_NODES,
      ALL_EDGES,
      email.messages,
      config
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
      emailId: email.id,
      difficulty: email.difficulty,
      expected: email.expectedFinalNodeId,
      got: result.finalNodeId,
      needsHumanReview: result.needsHumanReview,
      llmCalled,
      outcome,
      points,
    });
  }

  return { config, score: totalScore, details };
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

function configKey(c: Config): string {
  return [c.thetaMin, c.lambdaDepthDecay, c.softmaxTemperature, c.thetaSpread, c.deltaDescentMargin, c.crossBranchMargin].join(",");
}

function isCurrentDefaults(c: Config): boolean {
  return (
    c.thetaMin === THETA_MIN &&
    c.lambdaDepthDecay === LAMBDA_DEPTH_DECAY &&
    c.softmaxTemperature === SOFTMAX_TEMPERATURE &&
    c.thetaSpread === THETA_SPREAD &&
    c.deltaDescentMargin === DELTA_DESCENT_MARGIN &&
    c.crossBranchMargin === CROSS_BRANCH_MARGIN
  );
}

function fmt(n: number, width = 5): string {
  return n.toFixed(2).padStart(width);
}

function outcomeSymbol(o: EmailOutcome): string {
  switch (o) {
    case "correct":       return "✓";
    case "review_allowed": return "~";
    case "review_denied": return "!";
    case "wrong":         return "✗";
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const embeddingProvider = makeRealEmbeddingProvider();
  const configs = [...generateCombinations()];
  const total = configs.length;

  console.log(`\nGrid search: ${total.toLocaleString()} combinations × ${TEST_EMAILS.length} fixtures\n`);
  process.stdout.write("Progress: [");

  const DOT_INTERVAL = Math.max(1, Math.floor(total / 50));
  const results: BenchmarkResult[] = [];

  for (let i = 0; i < configs.length; i++) {
    if (i % DOT_INTERVAL === 0) process.stdout.write(".");
    const result = await runConfig(configs[i]!, embeddingProvider, TEST_EMAILS);
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
    TEST_EMAILS.filter((e) => e.difficulty === "easy").length * POINTS.correctEasy +
    TEST_EMAILS.filter((e) => e.difficulty !== "easy").length * POINTS.correctOther;

  console.log(`Max achievable score: ${maxScore}\n`);
  console.log(
    "Rank   Score  thetaMin  lambda  temp   spread  delta  cross  LLM%"
  );
  console.log("─".repeat(72));

  for (let i = 0; i < Math.min(15, results.length); i++) {
    const { config: c, score, details } = results[i]!;
    const llmPct = Math.round((details.filter((d) => d.llmCalled).length / TEST_EMAILS.length) * 100);
    const mark = isCurrentDefaults(c) ? "  ← current defaults" : "";
    console.log(
      `${String(i + 1).padStart(4)}  ${String(score.toFixed(1)).padStart(6)}` +
      `  ${fmt(c.thetaMin)}  ${fmt(c.lambdaDepthDecay)}  ${fmt(c.softmaxTemperature)}` +
      `  ${fmt(c.thetaSpread)}  ${fmt(c.deltaDescentMargin)}  ${fmt(c.crossBranchMargin)}` +
      `  ${String(llmPct).padStart(3)}%${mark}`
    );
  }

  // ── Current defaults rank ────────────────────────────────────────────────────

  const currentDefaultsKey = configKey({
    thetaMin: THETA_MIN,
    lambdaDepthDecay: LAMBDA_DEPTH_DECAY,
    softmaxTemperature: SOFTMAX_TEMPERATURE,
    thetaSpread: THETA_SPREAD,
    deltaDescentMargin: DELTA_DESCENT_MARGIN,
    crossBranchMargin: CROSS_BRANCH_MARGIN,
  });
  const currentRank = results.findIndex((r) => configKey(r.config) === currentDefaultsKey);
  console.log(
    `\nCurrent defaults → rank ${currentRank + 1} / ${total.toLocaleString()} ` +
    `(score: ${results[currentRank]?.score.toFixed(1)})`
  );

  // ── Per-email breakdown for rank 1 ──────────────────────────────────────────

  console.log("\n── Per-email breakdown (rank 1) ─────────────────────────────────────────");
  const best = results[0]!;
  for (const d of best.details) {
    const llm = d.llmCalled ? " [LLM]" : "";
    const sym = outcomeSymbol(d.outcome);
    const pts = d.points >= 0 ? `+${d.points}` : String(d.points);
    console.log(
      `  ${sym} [${d.difficulty.padEnd(6)}] ${d.emailId.padEnd(36)} → ${(d.got ?? "null").padEnd(28)} (${pts})${llm}`
    );
  }

  // ── Recommendation ───────────────────────────────────────────────────────────

  console.log("\n── Recommendation ────────────────────────────────────────────────────────");
  if (currentRank === 0) {
    console.log("Current defaults are already rank 1. No change needed.\n");
  } else {
    const winner = best.config;
    console.log("Update sorter.ts constants to:");
    console.log(`  THETA_MIN            = ${winner.thetaMin}`);
    console.log(`  LAMBDA_DEPTH_DECAY   = ${winner.lambdaDepthDecay}`);
    console.log(`  SOFTMAX_TEMPERATURE  = ${winner.softmaxTemperature}`);
    console.log(`  THETA_SPREAD         = ${winner.thetaSpread}`);
    console.log(`  DELTA_DESCENT_MARGIN = ${winner.deltaDescentMargin}`);
    console.log(`  CROSS_BRANCH_MARGIN  = ${winner.crossBranchMargin}`);
    console.log();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
