import OpenAI from "openai";
import type { AIProvider } from "../types.js";

/**
 * Thrown when the LLM API rejects the credentials (HTTP 401). Like a missing
 * embedding model, this is a deployment misconfiguration, not a transient
 * fault, so callers should fail fast rather than retry.
 */
export class LLMAuthenticationError extends Error {
  constructor(provider: string, model: string, body: string) {
    super(`LLM authentication failed for provider "${provider}" model "${model}" (401): ${body}`);
    this.name = "LLMAuthenticationError";
  }
}

/** True for an OpenAI-SDK error (or compatible endpoint) that signals bad credentials. */
function isAuthError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    (err as { status?: unknown }).status === 401
  );
}

/** Request timeout (ms). Bounds a single chat call so a hung connection fails
 *  fast and lets the caller retry rather than blocking a worker slot. */
const REQUEST_TIMEOUT_MS = 60_000;

export class FrontierAIProvider implements AIProvider {
  readonly providerName: string;
  readonly modelName: string;
  private readonly client: OpenAI;
  private readonly reasoningEffort?: "low" | "medium" | "high" | "none";

  constructor(opts: {
    provider: string;
    apiKey: string;
    model: string;
    baseUrl?: string;
    reasoningEffort?: "low" | "medium" | "high" | "none";
  }) {
    this.providerName = opts.provider;
    this.modelName = opts.model;
    if (opts.reasoningEffort) this.reasoningEffort = opts.reasoningEffort;
    this.client = new OpenAI({
      apiKey: opts.apiKey,
      timeout: REQUEST_TIMEOUT_MS,
      // The SDK retries multiply with the caller's own retries — the routing
      // path runs under BullMQ (3 attempts with backoff), so the SDK default of
      // 2 means up to 3×3 = 9 paid model calls per thread during a provider
      // outage. Cap SDK retries at 1 (still honors Retry-After for a single 429
      // bounce) and let BullMQ own the retry budget, roughly halving worst-case
      // cost. Draft generation (synchronous) keeps that one fast auto-retry.
      maxRetries: 1,
      ...(opts.baseUrl ? { baseURL: opts.baseUrl } : {}),
    });
  }

  async chat(messages: Array<{ role: "system" | "user" | "assistant"; content: string }>): Promise<string> {
    let completion;
    try {
      completion = await this.client.chat.completions.create({
        model: this.modelName,
        messages,
        response_format: { type: "json_object" },
        // "none" is valid for Gemini's OpenAI-compat endpoint but absent from the
        // SDK's ReasoningEffort union ('low'|'medium'|'high'|null), so cast the
        // single field rather than loosening the whole call.
        ...(this.reasoningEffort
          ? { reasoning_effort: this.reasoningEffort as "low" | "medium" | "high" }
          : {}),
      });
    } catch (err) {
      if (isAuthError(err)) {
        const body = err instanceof Error ? err.message : String(err);
        throw new LLMAuthenticationError(this.providerName, this.modelName, body);
      }
      throw err;
    }

    const content = completion.choices[0]?.message?.content;
    if (typeof content !== "string") {
      throw new Error("Frontier LLM returned no content");
    }
    return content;
  }
}
