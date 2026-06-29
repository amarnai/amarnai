/**
 * Gemini Batch-API provider (BACKFILL_BATCH_MODE).
 *
 * Submits embedding / generateContent requests as an async batch (~50% of the
 * interactive price, up to 24h turnaround), polls the batch operation, and maps
 * results back to caller `key`s via per-request metadata.
 *
 * REST surface (verified live against generativelanguage v1beta, June 2026):
 *   - Create generate: POST /v1beta/models/{model}:batchGenerateContent
 *   - Create embed:    POST /v1beta/models/{model}:asyncBatchEmbedContent
 *     Body: { batch: { displayName, inputConfig: { requests: { requests: [ {request, metadata:{key}} ] } } } }
 *     → 200 { name: "batches/…", metadata: { state: "BATCH_STATE_PENDING", … } }
 *   - Poll/fetch:      GET  /v1beta/{batchName}   → .metadata.state ("BATCH_STATE_*"),
 *     results in .response.inlinedResponses (generate) /
 *     .response.inlinedEmbedContentResponses (embed) once SUCCEEDED.
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
import { composeEmbeddingModelId } from "../embedding/model-id.js";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

// Live API uses BATCH_STATE_*; JOB_STATE_* kept as a defensive alias.
type GeminiBatchState = string;

function mapState(state: GeminiBatchState): BatchPollStatus {
  switch (state) {
    case "BATCH_STATE_SUCCEEDED":
    case "JOB_STATE_SUCCEEDED":
      return "COMPLETED";
    case "BATCH_STATE_FAILED":
    case "BATCH_STATE_CANCELLED":
    case "JOB_STATE_FAILED":
    case "JOB_STATE_CANCELLED":
      return "FAILED";
    case "BATCH_STATE_EXPIRED":
    case "JOB_STATE_EXPIRED":
      return "EXPIRED";
    default:
      // BATCH_STATE_PENDING / BATCH_STATE_RUNNING / unknown → keep polling.
      return "RUNNING";
  }
}

/**
 * The inline-results field may come back either as a bare array or wrapped one
 * level deep (RPC list wrapper, mirroring the request's nested `requests`).
 * Accept both: `container[field]` as an array, or `container[field][field]`.
 */
function inlineList<T>(container: Record<string, unknown> | undefined, field: string): T[] {
  const v = container?.[field];
  if (Array.isArray(v)) return v as T[];
  const inner = (v as Record<string, unknown> | undefined)?.[field];
  if (Array.isArray(inner)) return inner as T[];
  return [];
}

export type GeminiBatchOptions = {
  embedApiKey: string;
  embedModel: string;
  embedDimensions?: number;
  llmApiKey: string;
  llmModel: string;
};

export class GeminiBatchProvider implements BatchProvider {
  readonly providerName = "gemini";
  readonly embedModelName: string;
  readonly llmModelName: string;
  private readonly embedApiKey: string;
  private readonly embedModel: string;
  private readonly embedDimensions: number | undefined;
  private readonly llmApiKey: string;
  private readonly llmModel: string;

  constructor(opts: GeminiBatchOptions) {
    this.embedApiKey = opts.embedApiKey;
    this.embedModel = opts.embedModel;
    this.embedDimensions = opts.embedDimensions;
    this.llmApiKey = opts.llmApiKey;
    this.llmModel = opts.llmModel;
    this.embedModelName = composeEmbeddingModelId(opts.embedModel, opts.embedDimensions);
    this.llmModelName = opts.llmModel;
  }

  async submitEmbeddings(reqs: BatchEmbedRequest[]): Promise<BatchSubmitResult> {
    const requests = reqs.map((r) => ({
      request: {
        model: `models/${this.embedModel}`,
        content: { parts: [{ text: r.text }] },
        taskType: "SEMANTIC_SIMILARITY",
        ...(this.embedDimensions ? { outputDimensionality: this.embedDimensions } : {}),
      },
      metadata: { key: r.key },
    }));
    const name = await this.createBatch(this.embedModel, "asyncBatchEmbedContent", this.embedApiKey, requests);
    return { providerJobId: name };
  }

  async submitGenerate(reqs: BatchGenerateRequest[]): Promise<BatchSubmitResult> {
    const requests = reqs.map((r) => ({
      request: {
        contents: [{ role: "user", parts: [{ text: r.user }] }],
        systemInstruction: { parts: [{ text: r.system }] },
        generationConfig: { responseMimeType: "application/json" },
      },
      metadata: { key: r.key },
    }));
    const name = await this.createBatch(this.llmModel, "batchGenerateContent", this.llmApiKey, requests);
    return { providerJobId: name };
  }

  async poll(providerJobId: string): Promise<BatchPollStatus> {
    const { state } = await this.getResource(providerJobId, this.embedApiKey || this.llmApiKey);
    return mapState(state);
  }

  async fetchEmbeddingResults(providerJobId: string): Promise<BatchEmbedResults> {
    const { resource } = await this.getResource(providerJobId, this.embedApiKey);
    // Live API returns embed results under `inlinedResponses` too (NOT
    // `inlinedEmbedContentResponses` as the docs imply); each item is
    // { metadata:{key}, response:{ embedding:{ values } } }.
    const list = inlineList<GeminiInlineEmbed>(resource.response, "inlinedResponses");
    let inputTokens = 0;
    const items = list.map((r) => {
      const key = r.metadata?.key ?? "";
      const values = r.response?.embedding?.values ?? null;
      inputTokens += r.response?.usageMetadata?.totalTokenCount ?? 0;
      return { key, vector: values, ...(r.error ? { error: JSON.stringify(r.error) } : {}) };
    });
    return { items, inputTokens, outputTokens: 0 };
  }

  async fetchGenerateResults(providerJobId: string): Promise<BatchGenerateResults> {
    const { resource } = await this.getResource(providerJobId, this.llmApiKey);
    const list = inlineList<GeminiInlineGenerate>(resource.response, "inlinedResponses");
    let inputTokens = 0;
    let outputTokens = 0;
    const items = list.map((r) => {
      const key = r.metadata?.key ?? "";
      const text = r.response?.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
      inputTokens += r.response?.usageMetadata?.promptTokenCount ?? 0;
      outputTokens += r.response?.usageMetadata?.candidatesTokenCount ?? 0;
      return { key, output: text, ...(r.error ? { error: JSON.stringify(r.error) } : {}) };
    });
    return { items, inputTokens, outputTokens };
  }

  // ── REST plumbing ───────────────────────────────────────────────────────────

  private async createBatch(
    model: string,
    method: "asyncBatchEmbedContent" | "batchGenerateContent",
    apiKey: string,
    requests: unknown[],
  ): Promise<string> {
    const url = `${GEMINI_API_BASE}/models/${model}:${method}?key=${apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        batch: { displayName: `amarnai-${method}`, inputConfig: { requests: { requests } } },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "(no body)");
      throw new Error(`Gemini batch submit error ${res.status}: ${body}`);
    }
    const data = (await res.json()) as { name?: string };
    if (!data.name) throw new Error("Gemini batch submit returned no operation name");
    return data.name;
  }

  private async getResource(
    name: string,
    apiKey: string,
  ): Promise<{ state: GeminiBatchState; resource: GeminiBatchResource }> {
    // `name` is "batches/…" (or "…/operations/…"); GET it directly.
    const url = `${GEMINI_API_BASE}/${name}?key=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text().catch(() => "(no body)");
      throw new Error(`Gemini batch poll error ${res.status}: ${body}`);
    }
    const resource = (await res.json()) as GeminiBatchResource;
    const state = resource.metadata?.state ?? resource.state ?? "JOB_STATE_RUNNING";
    return { state, resource };
  }
}

type GeminiUsage = { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };

type GeminiInlineGenerate = {
  metadata?: { key?: string };
  error?: unknown;
  response?: {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    usageMetadata?: GeminiUsage;
  };
};

type GeminiInlineEmbed = {
  metadata?: { key?: string };
  error?: unknown;
  response?: { embedding?: { values: number[] }; usageMetadata?: GeminiUsage };
};

type GeminiBatchResource = {
  state?: GeminiBatchState;
  metadata?: { state?: GeminiBatchState };
  response?: {
    inlinedResponses?: { inlinedResponses?: GeminiInlineGenerate[] };
    inlinedEmbedContentResponses?: { inlinedEmbedContentResponses?: GeminiInlineEmbed[] };
  };
};
