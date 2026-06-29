/**
 * Deterministic in-memory `BatchProvider` for tests and local dev
 * (`BACKFILL_BATCH_MODE` with a mock provider). Submissions are stored by
 * provider job id; `poll` returns COMPLETED immediately (configurable) and
 * `fetch*` replays canned results.
 *
 * Defaults make it self-contained: embeddings are deterministic hash vectors,
 * and LLM answers select `candidate_0` with high confidence (a valid
 * NodeSelectionResult). Tests override `embedFn` / `answerFn` / `status` to
 * exercise specific routing, partial failures, or non-terminal poll states.
 */
import type {
  BatchProvider,
  BatchEmbedRequest,
  BatchGenerateRequest,
  BatchEmbedResults,
  BatchGenerateResults,
  BatchPollStatus,
  BatchSubmitResult,
} from "../batch/types.js";

export type MockBatchOptions = {
  embedModelName?: string;
  llmModelName?: string;
  dim?: number;
  /** Per-text embedding override; defaults to a deterministic hash vector. */
  embedFn?: (text: string, key: string) => number[];
  /** Per-request answer override; defaults to selecting candidate_0. */
  answerFn?: (req: BatchGenerateRequest) => string;
  /** Force a poll status (default COMPLETED). */
  status?: BatchPollStatus;
};

type StoredEmbed = { kind: "embed"; reqs: BatchEmbedRequest[] };
type StoredGenerate = { kind: "generate"; reqs: BatchGenerateRequest[] };

function deterministicVector(text: string, dim: number): number[] {
  // Small FNV-1a-style hash spread across `dim` slots; stable for a given text.
  const v = new Array<number>(dim).fill(0);
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
    const idx = i % dim;
    v[idx] = (v[idx] ?? 0) + ((h >>> 0) % 1000) / 1000;
  }
  return v;
}

function defaultAnswer(): string {
  return JSON.stringify({
    selectedNodeId: "candidate_0",
    confidence: 0.95,
    explanation: "mock batch selection",
    needsHumanReview: false,
  });
}

export class MockBatchProvider implements BatchProvider {
  readonly providerName = "mock";
  readonly embedModelName: string;
  readonly llmModelName: string;
  private readonly dim: number;
  private readonly embedFn: (text: string, key: string) => number[];
  private readonly answerFn: (req: BatchGenerateRequest) => string;
  private readonly forcedStatus: BatchPollStatus;
  private readonly store = new Map<string, StoredEmbed | StoredGenerate>();
  private counter = 0;

  constructor(opts: MockBatchOptions = {}) {
    this.embedModelName = opts.embedModelName ?? "mock-embed-v1";
    this.llmModelName = opts.llmModelName ?? "mock-llm-v1";
    this.dim = opts.dim ?? 8;
    this.embedFn = opts.embedFn ?? ((text) => deterministicVector(text, this.dim));
    this.answerFn = opts.answerFn ?? (() => defaultAnswer());
    this.forcedStatus = opts.status ?? "COMPLETED";
  }

  private nextJobId(prefix: string): string {
    this.counter += 1;
    return `mock-${prefix}-${this.counter}`;
  }

  async submitEmbeddings(reqs: BatchEmbedRequest[]): Promise<BatchSubmitResult> {
    const providerJobId = this.nextJobId("embed");
    this.store.set(providerJobId, { kind: "embed", reqs });
    return { providerJobId };
  }

  async submitGenerate(reqs: BatchGenerateRequest[]): Promise<BatchSubmitResult> {
    const providerJobId = this.nextJobId("gen");
    this.store.set(providerJobId, { kind: "generate", reqs });
    return { providerJobId };
  }

  async poll(_providerJobId: string): Promise<BatchPollStatus> {
    return this.forcedStatus;
  }

  async fetchEmbeddingResults(providerJobId: string): Promise<BatchEmbedResults> {
    const stored = this.store.get(providerJobId);
    if (!stored || stored.kind !== "embed") {
      throw new Error(`MockBatchProvider: no embed batch ${providerJobId}`);
    }
    const items = stored.reqs.map((r) => ({ key: r.key, vector: this.embedFn(r.text, r.key) }));
    const inputTokens = stored.reqs.reduce((n, r) => n + Math.ceil(r.text.length / 4), 0);
    return { items, inputTokens, outputTokens: 0 };
  }

  async fetchGenerateResults(providerJobId: string): Promise<BatchGenerateResults> {
    const stored = this.store.get(providerJobId);
    if (!stored || stored.kind !== "generate") {
      throw new Error(`MockBatchProvider: no generate batch ${providerJobId}`);
    }
    const items = stored.reqs.map((r) => ({ key: r.key, output: this.answerFn(r) }));
    const inputTokens = stored.reqs.reduce(
      (n, r) => n + Math.ceil((r.system.length + r.user.length) / 4),
      0
    );
    const outputTokens = items.length * 20;
    return { items, inputTokens, outputTokens };
  }
}
