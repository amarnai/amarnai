/**
 * Taxonomy-generation tuning harness.
 *
 * Runs synthetic inbox profiles of increasing "variety" (see
 * fixtures/taxonomy-gen-profiles.ts) through the real generateTaxonomyFromProfile
 * path against LIVE Gemini, and reports the structure of the taxonomy the model
 * produces UNPROMPTED by any leaf-count band: leaf count, top-level count, depth,
 * the share of leaves backed by inbox signal, catch-all correctness, fallback
 * rate, and tokens/cost.
 *
 * The point is to set the variety-driven leaf/top-level target bands (and decide
 * whether to raise CLUSTER_DOMAIN_LIMIT) from observed flash behaviour rather
 * than a guess. It changes no shipped code — it only measures.
 *
 * Taxonomy generation is pinned to the capable tier in prod (TAXONOMY_LLM_MODEL=
 * gemini-2.5-flash), NOT the flash-lite routing tier, so this harness defaults to
 * the same. Provide Gemini credentials via env (.env.local / Railway):
 *
 *   pnpm --filter @aziru/ai benchmark:taxonomy-gen
 *
 * Env knobs:
 *   TAXONOMY_LLM_MODEL        model to hit (default gemini-2.5-flash)
 *   TAXONOMY_REASONING_EFFORT low|medium|high|none (default none, as in prod)
 *   BENCHMARK_GEN_REPEATS     runs per fixture (default 2; flash is non-deterministic)
 */
import OpenAI from "openai";
import { matchTemplateToProfile } from "@aziru/core/taxonomy";
import { generateTaxonomyFromProfile } from "../taxonomy-gen/generate.js";
import type { AIProvider } from "../types.js";
import type { TaxonomyTransferFile } from "@aziru/shared";
import {
  PROFILE_FIXTURES,
  recurringDomainCount,
  profileSignalTokens,
  leafIsSupported,
  type ProfileFixture,
} from "./fixtures/taxonomy-gen-profiles.js";

// Gemini 2.5 Flash rates ($/1M tokens). Approximate — confirm before quoting.
const RATE_INPUT_PER_M = 0.3;
const RATE_OUTPUT_PER_M = 2.5;

const MODEL = process.env["TAXONOMY_LLM_MODEL"] || "gemini-2.5-flash";
const REPEATS = Number(process.env["BENCHMARK_GEN_REPEATS"] || "2");
const EFFORT = process.env["TAXONOMY_REASONING_EFFORT"]; // undefined → omit (thinking off)

// ─── Live Gemini provider with per-call telemetry ─────────────────────────────

type CallRecord = { latencyMs: number; promptTokens: number; completionTokens: number };

function makeGeminiProvider(sink: CallRecord[]): AIProvider {
  const apiKey = process.env["FRONTIER_LLM_API_KEY"];
  if (!apiKey) {
    throw new Error(
      "FRONTIER_LLM_API_KEY is required. Provide it via .env.local / Railway before running.",
    );
  }
  const baseURL =
    process.env["FRONTIER_LLM_BASE_URL"] ||
    "https://generativelanguage.googleapis.com/v1beta/openai/";
  // maxRetries 1 mirrors the prod FrontierAIProvider (one fast retry for a 429 bounce).
  const client = new OpenAI({ apiKey, baseURL, timeout: 90_000, maxRetries: 1 });

  return {
    providerName: "gemini-bench",
    modelName: MODEL,
    async chat(messages) {
      const start = performance.now();
      const params: Record<string, unknown> = {
        model: MODEL,
        messages,
        response_format: { type: "json_object" },
      };
      if (EFFORT) params["reasoning_effort"] = EFFORT;
      const completion = await client.chat.completions.create(
        params as unknown as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
      );
      const u = completion.usage;
      sink.push({
        latencyMs: performance.now() - start,
        promptTokens: u?.prompt_tokens ?? 0,
        completionTokens: u?.completion_tokens ?? 0,
      });
      const content = completion.choices[0]?.message?.content;
      if (typeof content !== "string") throw new Error("Gemini returned no content");
      return content;
    },
  };
}

// ─── Structure metrics ────────────────────────────────────────────────────────

interface Structure {
  leaves: number;
  topLevel: number;
  maxDepth: number;
  supportedLeaves: number;
  catchAllOk: boolean;
}

function analyze(file: TaxonomyTransferFile, signal: Set<string>): Structure {
  const childrenOf = new Map<string, string[]>();
  for (const e of file.edges) {
    const list = childrenOf.get(e.sourceRef) ?? [];
    list.push(e.targetRef);
    childrenOf.set(e.sourceRef, list);
  }
  const root = file.nodes.find((n) => n.isRoot);
  const isLeaf = (ref: string) => !childrenOf.has(ref) || childrenOf.get(ref)!.length === 0;

  const leafNodes = file.nodes.filter((n) => !n.isRoot && isLeaf(n.ref));
  const topLevel = root ? (childrenOf.get(root.ref) ?? []).length : 0;

  let maxDepth = 0;
  const walk = (ref: string, depth: number) => {
    maxDepth = Math.max(maxDepth, depth);
    for (const child of childrenOf.get(ref) ?? []) walk(child, depth + 1);
  };
  if (root) walk(root.ref, 0);

  const supportedLeaves = leafNodes.filter((n) =>
    leafIsSupported(n.name, n.description, signal),
  ).length;

  const catchAlls = file.nodes.filter((n) => n.isCatchAll);
  const catchAllOk =
    catchAlls.length === 1 && !catchAlls[0]!.isRoot && isLeaf(catchAlls[0]!.ref);

  return { leaves: leafNodes.length, topLevel, maxDepth, supportedLeaves, catchAllOk };
}

// ─── Run one fixture N times ──────────────────────────────────────────────────

interface RunResult extends Structure {
  fixture: string;
  fallback: boolean;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  error?: string;
}

async function runFixture(fx: ProfileFixture, now: Date): Promise<RunResult[]> {
  const signal = profileSignalTokens(fx.profile);
  const template = matchTemplateToProfile(fx.profile);
  const results: RunResult[] = [];

  for (let i = 0; i < REPEATS; i++) {
    const records: CallRecord[] = [];
    const provider = makeGeminiProvider(records);
    try {
      const generated = await generateTaxonomyFromProfile({
        profile: fx.profile,
        seed: template.file,
        matchedTemplateName: template.name,
        targetLanguage: "English",
        provider,
        now,
      });
      const s = analyze(generated.file, signal);
      const calls = records.reduce(
        (a, r) => ({
          promptTokens: a.promptTokens + r.promptTokens,
          completionTokens: a.completionTokens + r.completionTokens,
          latencyMs: a.latencyMs + r.latencyMs,
        }),
        { promptTokens: 0, completionTokens: 0, latencyMs: 0 },
      );
      results.push({ fixture: fx.name, fallback: generated.usedFallback, ...s, ...calls });
      process.stdout.write(generated.usedFallback ? "F" : "*");
    } catch (e) {
      results.push({
        fixture: fx.name,
        fallback: false,
        leaves: 0,
        topLevel: 0,
        maxDepth: 0,
        supportedLeaves: 0,
        catchAllOk: false,
        promptTokens: 0,
        completionTokens: 0,
        latencyMs: 0,
        error: e instanceof Error ? e.message : String(e),
      });
      process.stdout.write("E");
    }
  }
  return results;
}

// ─── Reporting ────────────────────────────────────────────────────────────────

function range(xs: number[]): string {
  if (xs.length === 0) return "n/a";
  const min = Math.min(...xs);
  const max = Math.max(...xs);
  return min === max ? `${min}` : `${min}-${max}`;
}

function avg(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

async function main(): Promise<void> {
  const now = new Date("2026-06-30T12:00:00.000Z");
  console.log(
    `\nTaxonomy-generation tuning harness\n` +
      `Model:    ${MODEL}  (reasoning_effort: ${EFFORT || "none/omitted"})\n` +
      `Repeats:  ${REPEATS} per fixture\n` +
      `Fixtures: ${PROFILE_FIXTURES.map((f) => f.name).join(", ")}\n`,
  );

  const all: RunResult[] = [];
  for (const fx of PROFILE_FIXTURES) {
    const recurring = recurringDomainCount(fx.profile);
    const distinct = fx.profile.senderDomains.length;
    process.stdout.write(
      `\n${fx.name.padEnd(9)} (${distinct} domains, ${recurring} recurring, ${fx.profile.eligibleThreadCount} threads, template "${matchTemplateToProfile(fx.profile).name}") `,
    );
    const runs = await runFixture(fx, now);
    all.push(...runs);
  }
  process.stdout.write("\n\n");

  console.log("Results (ranges across repeats; supported = leaves backed by inbox signal):\n");
  const head =
    "fixture    distinct  recurring   leaves   top-lvl   depth   supported   catchAll   fallback";
  console.log(head);
  console.log("-".repeat(head.length));
  for (const fx of PROFILE_FIXTURES) {
    const runs = all.filter((r) => r.fixture === fx.name && !r.error);
    const errs = all.filter((r) => r.fixture === fx.name && r.error);
    const distinct = fx.profile.senderDomains.length;
    const recurring = recurringDomainCount(fx.profile);
    const supportedStr = range(runs.map((r) => r.supportedLeaves));
    const leavesStr = range(runs.map((r) => r.leaves));
    const catchAll = runs.every((r) => r.catchAllOk) ? "ok" : "BAD";
    const fallback = runs.filter((r) => r.fallback).length;
    console.log(
      `${fx.name.padEnd(10)} ${String(distinct).padStart(7)} ${String(recurring).padStart(10)} ` +
        `${leavesStr.padStart(8)} ${range(runs.map((r) => r.topLevel)).padStart(9)} ` +
        `${range(runs.map((r) => r.maxDepth)).padStart(7)} ` +
        `${`${supportedStr}/${leavesStr}`.padStart(11)} ${catchAll.padStart(10)} ` +
        `${`${fallback}/${runs.length + errs.length}`.padStart(10)}` +
        (errs.length ? `   ERRORS:${errs.length}` : ""),
    );
  }

  // Cost / latency summary.
  const ok = all.filter((r) => !r.error);
  const totalIn = ok.reduce((a, r) => a + r.promptTokens, 0);
  const totalOut = ok.reduce((a, r) => a + r.completionTokens, 0);
  const estCost = (totalIn / 1e6) * RATE_INPUT_PER_M + (totalOut / 1e6) * RATE_OUTPUT_PER_M;
  console.log(
    `\nPer-run avg: ${avg(ok.map((r) => r.promptTokens)).toFixed(0)} in / ` +
      `${avg(ok.map((r) => r.completionTokens)).toFixed(0)} out tokens, ` +
      `${avg(ok.map((r) => r.latencyMs)).toFixed(0)} ms`,
  );
  console.log(
    `Total over ${ok.length} runs: in ${totalIn}  out ${totalOut}  ~$${estCost.toFixed(5)} (verify Gemini rates)`,
  );

  const errors = all.filter((r) => r.error);
  if (errors.length) {
    console.log(`\n${errors.length} errored run(s):`);
    for (const e of errors) console.log(`  ${e.fixture}: ${e.error?.slice(0, 120)}`);
  }
  console.log(
    `\nLegend: "*" generated  "F" fell back to seed  "E" error.\n` +
      `Read the leaves/top-level ranges per variety tier to set the target bands;\n` +
      `low supported/leaves on "broad" means CLUSTER_DOMAIN_LIMIT is starving the model of themes.\n`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
