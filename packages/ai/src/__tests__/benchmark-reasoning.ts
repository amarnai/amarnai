/**
 * Reasoning-effort benchmark for the cross-branch disambiguation LLM call.
 *
 * The router only calls the LLM for cross-branch ambiguity; embeddings decide
 * everything else. This benchmark measures how Gemini's thinking budget affects
 * that call across three settings:
 *
 *   - default : reasoning_effort omitted (current production behaviour, thinking ON)
 *   - low     : reasoning_effort = "low"  (small, bounded thinking budget)
 *   - none    : reasoning_effort = "none" (thinking OFF)
 *
 * For each setting it reports, over the LLM-invoked subset (the only emails the
 * setting can change): accuracy, errors (e.g. "Premature close"), latency, and
 * output/reasoning token counts — so the accuracy vs cost trade-off is data,
 * not a guess.
 *
 * Embeddings are served from the pre-computed fixture (no embedding API needed).
 * Only the LLM is live, so set the Gemini credentials before running. The
 * easiest way is to inject the worker's env from Railway:
 *
 *   railway run --service worker -- \
 *     pnpm --filter @amarnai/ai benchmark:reasoning
 *
 * Or export FRONTIER_LLM_API_KEY (and optionally FRONTIER_LLM_MODEL /
 * FRONTIER_LLM_BASE_URL) yourself and run:
 *
 *   pnpm --filter @amarnai/ai benchmark:reasoning
 */
import OpenAI from "openai";
import { sortThreadByEmbedding } from "../embedding/sorter.js";
import { makeRealEmbeddingProvider } from "./fixtures/real-embedding-table.js";
import {
  ALL_NODES,
  ALL_EDGES,
  TEST_EMAILS,
  ALL_NODES_D2,
  ALL_EDGES_D2,
  D2_AMBIGUOUS_EMAIL,
  ALL_NODES_D3,
  ALL_EDGES_D3,
  TEST_EMAILS_D3,
  type TestEmail,
} from "./fixtures/sorting-fixtures.js";
import { createEmbeddingProvider, getEmbeddingProviderConfig } from "../index.js";
import type { EmbeddingProvider } from "../embedding/types.js";
import type { AIProvider, TaxonomyNodeInput, TaxonomyEdgeInput } from "../types.js";

// ─── Settings under test ────────────────────────────────────────────────────

type ReasoningEffort = "default" | "low" | "none";
const SETTINGS: ReasoningEffort[] = ["default", "low", "none"];

// Gemini 2.5 Flash rates ($/1M tokens). Thinking tokens bill as output. These
// are approximate and may be stale — confirm current pricing before relying on
// the dollar estimate. Token counts below are exact and provider-reported.
const RATE_INPUT_PER_M = 0.3;
const RATE_OUTPUT_PER_M = 2.5;

// ─── Live Gemini provider with per-call telemetry ─────────────────────────────

type CallRecord = {
  latencyMs: number;
  promptTokens: number;
  completionTokens: number; // includes reasoning tokens
  reasoningTokens: number;
  error?: string;
};

function makeGeminiProvider(effort: ReasoningEffort, sink: CallRecord[]): AIProvider {
  const apiKey = process.env["FRONTIER_LLM_API_KEY"];
  if (!apiKey) {
    throw new Error(
      "FRONTIER_LLM_API_KEY is required. Run via `railway run --service worker -- ...` " +
        "or export the key before running."
    );
  }
  const baseURL =
    process.env["FRONTIER_LLM_BASE_URL"] ||
    "https://generativelanguage.googleapis.com/v1beta/openai/";
  const model = process.env["FRONTIER_LLM_MODEL"] || "gemini-2.5-flash";

  // maxRetries 0 so each email makes exactly one attempt — clean latency and a
  // faithful reproduction of a single production call.
  const client = new OpenAI({ apiKey, baseURL, timeout: 90_000, maxRetries: 0 });

  return {
    providerName: "gemini-bench",
    modelName: model,
    async chat(messages) {
      const start = performance.now();
      try {
        const params: Record<string, unknown> = {
          model,
          messages,
          response_format: { type: "json_object" },
        };
        if (effort !== "default") params["reasoning_effort"] = effort;

        const completion = await client.chat.completions.create(
          params as unknown as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming
        );
        const latencyMs = performance.now() - start;
        const u = completion.usage;
        const reasoningTokens =
          (u?.completion_tokens_details as { reasoning_tokens?: number } | undefined)
            ?.reasoning_tokens ?? 0;
        sink.push({
          latencyMs,
          promptTokens: u?.prompt_tokens ?? 0,
          completionTokens: u?.completion_tokens ?? 0,
          reasoningTokens,
        });
        const content = completion.choices[0]?.message?.content;
        if (typeof content !== "string") throw new Error("Gemini returned no content");
        return content;
      } catch (err) {
        sink.push({
          latencyMs: performance.now() - start,
          promptTokens: 0,
          completionTokens: 0,
          reasoningTokens: 0,
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    },
  };
}

// ─── Per-email run ────────────────────────────────────────────────────────────

// In-memory cache so repeated texts (the same nodes across every email/setting)
// are embedded once, not on every sortThreadByEmbedding call.
function memoizeEmbeddings(inner: EmbeddingProvider): EmbeddingProvider {
  const cache = new Map<string, number[]>();
  return {
    providerName: inner.providerName,
    modelName: inner.modelName,
    async embed(texts: string[]): Promise<number[][]> {
      const missing = texts.filter((t) => !cache.has(t));
      if (missing.length > 0) {
        const vectors = await inner.embed(missing);
        missing.forEach((t, i) => cache.set(t, vectors[i]!));
      }
      return texts.map((t) => cache.get(t)!);
    },
  };
}

// Prefer the configured production embedding model (gemini-embedding-001) so the
// escalation gate and candidate sets match prod — that is what makes the
// accuracy numbers representative. Falls back to the qwen3 fixture offline, in
// which case accuracy is NOT prod-faithful (latency/cost still are).
function selectEmbeddingProvider(): { provider: EmbeddingProvider; label: string } {
  const cfg = getEmbeddingProviderConfig();
  if (cfg.provider !== "mock") {
    const live = memoizeEmbeddings(createEmbeddingProvider(cfg));
    return { provider: live, label: `live ${cfg.provider}/${live.modelName} (prod-faithful)` };
  }
  const fixture = makeRealEmbeddingProvider();
  return {
    provider: fixture,
    label: `fixture ${fixture.modelName} — NOT the prod model; accuracy not representative`,
  };
}

const { provider: embeddingProvider, label: embeddingLabel } = selectEmbeddingProvider();

// "correct"    routed to the expected node
// "review_ok"  returned needs-review and that is acceptable for this email
// "review_bad" returned needs-review but the email should have been routed
// "wrong"      routed to the wrong node
// "error"      the LLM call threw (e.g. "Premature close")
// "skipped"    no embedding fixture for this email — not scored
type Outcome = "correct" | "review_ok" | "review_bad" | "wrong" | "error" | "skipped";

type EmailRun = {
  email: TestEmail;
  llmCalled: boolean;
  outcome: Outcome;
  got: string | null;
  records: CallRecord[];
};

async function runEmail(
  email: TestEmail,
  nodes: TaxonomyNodeInput[],
  edges: TaxonomyEdgeInput[],
  effort: ReasoningEffort
): Promise<EmailRun> {
  const records: CallRecord[] = [];
  const llm = makeGeminiProvider(effort, records);

  let got: string | null = null;
  let needsHumanReview = false;
  let error: string | undefined;
  let skipped = false;

  try {
    const result = await sortThreadByEmbedding(
      embeddingProvider,
      llm,
      nodes,
      edges,
      email.messages,
      {} // production default constants
    );
    got = result.finalNodeId;
    needsHumanReview = result.needsHumanReview;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("fixture vector")) {
      skipped = true; // no pre-computed embedding for this email — not a model error
    } else {
      error = msg;
    }
  }

  let outcome: Outcome;
  if (skipped) outcome = "skipped";
  else if (error) outcome = "error";
  else if (got !== null && got === email.expectedFinalNodeId) outcome = "correct";
  else if (needsHumanReview) outcome = email.allowNeedsHumanReview ? "review_ok" : "review_bad";
  else outcome = "wrong";

  return { email, llmCalled: records.length > 0, outcome, got, records };
}

// ─── Datasets ─────────────────────────────────────────────────────────────────

const DATASETS: Array<{
  name: string;
  nodes: TaxonomyNodeInput[];
  edges: TaxonomyEdgeInput[];
  emails: TestEmail[];
}> = [
  { name: "d1", nodes: ALL_NODES, edges: ALL_EDGES, emails: TEST_EMAILS },
  { name: "d3", nodes: ALL_NODES_D3, edges: ALL_EDGES_D3, emails: TEST_EMAILS_D3 },
  { name: "d2", nodes: ALL_NODES_D2, edges: ALL_EDGES_D2, emails: [D2_AMBIGUOUS_EMAIL] },
];

// ─── Aggregation + reporting ──────────────────────────────────────────────────

function pct(n: number, d: number): string {
  if (d === 0) return "  n/a";
  return `${((100 * n) / d).toFixed(0).padStart(3)}%`;
}

function fmt(n: number, w = 6): string {
  return n.toFixed(0).padStart(w);
}

async function main(): Promise<void> {
  const allEmails = DATASETS.flatMap((d) =>
    d.emails.map((e) => ({ ds: d, email: e }))
  );
  console.log(
    `\nReasoning-effort benchmark — ${allEmails.length} labeled emails across ` +
      `${DATASETS.length} taxonomies, settings: ${SETTINGS.join(", ")}\n` +
      `LLM model:  ${process.env["FRONTIER_LLM_MODEL"] || "gemini-2.5-flash (default)"}\n` +
      `Embeddings: ${embeddingLabel}\n`
  );

  for (const effort of SETTINGS) {
    process.stdout.write(`Running "${effort}" `);
    const runs: EmailRun[] = [];
    for (const { ds, email } of allEmails) {
      const r = await runEmail(email, ds.nodes, ds.edges, effort);
      runs.push(r);
      const ch =
        r.outcome === "skipped" ? "·" : r.outcome === "error" ? "E" : r.llmCalled ? "*" : ".";
      process.stdout.write(ch);
    }
    process.stdout.write("\n");

    const scored = runs.filter((r) => r.outcome !== "skipped");
    const skippedCount = runs.length - scored.length;
    const llmRuns = scored.filter((r) => r.llmCalled);

    const errors = llmRuns.filter((r) => r.outcome === "error");
    const correct = llmRuns.filter((r) => r.outcome === "correct").length;
    const reviewOk = llmRuns.filter((r) => r.outcome === "review_ok").length;
    const reviewBad = llmRuns.filter((r) => r.outcome === "review_bad").length;
    const wrong = llmRuns.filter((r) => r.outcome === "wrong").length;
    const decided = llmRuns.length - errors.length; // non-errored LLM calls
    const errEx = errors[0]?.records.find((c) => c.error)?.error;
    const overallCorrect = scored.filter((r) => r.outcome === "correct").length;

    const llmCallRecords = llmRuns.flatMap((r) => r.records);
    const okCalls = llmCallRecords.filter((c) => !c.error);
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    const avg = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0);

    const totalIn = sum(okCalls.map((c) => c.promptTokens));
    const totalOut = sum(okCalls.map((c) => c.completionTokens));
    const totalReason = sum(okCalls.map((c) => c.reasoningTokens));
    const estCost =
      (totalIn / 1e6) * RATE_INPUT_PER_M + (totalOut / 1e6) * RATE_OUTPUT_PER_M;

    console.log(`\n── ${effort} ─────────────────────────────────────────────`);
    console.log(`  LLM-invoked emails  : ${llmRuns.length}  (skipped, no embedding fixture: ${skippedCount})`);
    console.log(`  Errors on LLM call  : ${errors.length}  ${errEx ? `e.g. "${errEx.slice(0, 70)}"` : ""}`);
    console.log(`  Routed correct (LLM): ${pct(correct, decided)}  (${correct}/${decided} non-errored)`);
    console.log(`  Review ok / bad     : ${reviewOk} / ${reviewBad}   Wrong routes: ${wrong}`);
    console.log(`  Accuracy (overall)  : ${pct(overallCorrect, scored.length)}  (${overallCorrect}/${scored.length})`);
    console.log(`  Avg latency / call  : ${fmt(avg(okCalls.map((c) => c.latencyMs)))} ms`);
    console.log(`  Output tok / call   : ${fmt(avg(okCalls.map((c) => c.completionTokens)))}  (reasoning: ${fmt(avg(okCalls.map((c) => c.reasoningTokens)))})`);
    console.log(`  Total tokens        : in ${totalIn}  out ${totalOut}  (reasoning ${totalReason})`);
    console.log(`  Est. cost (subset)  : $${estCost.toFixed(5)}  — verify Gemini rates`);
  }

  console.log(
    `\nLegend: "*" LLM-invoked  "." embeddings-only  "E" LLM error  "·" skipped (no embedding fixture)\n` +
      `Only LLM-invoked emails differ between settings; embeddings-only rows are identical.\n`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
