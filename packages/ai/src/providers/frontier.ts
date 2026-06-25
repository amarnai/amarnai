import OpenAI, { type ClientOptions } from "openai";
import { fetch as undiciFetch } from "undici";
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

/**
 * Thrown when the LLM API rejects the request itself (HTTP 400/403/404/422) — a
 * malformed body, an unknown model, a forbidden resource, an unprocessable
 * payload. Like an auth failure these are deterministic: the identical request
 * will be rejected again, so retrying only wastes attempts and cost. Callers
 * should fail fast (no retry). 408 (timeout) and 429 (rate limit) are
 * deliberately NOT mapped here — those are transient and worth retrying.
 */
export class LLMRequestError extends Error {
  readonly status: number;
  constructor(provider: string, model: string, status: number, body: string) {
    super(`LLM request rejected for provider "${provider}" model "${model}" (${status}): ${body}`);
    this.name = "LLMRequestError";
    this.status = status;
  }
}

/**
 * Wrap a fetch implementation so upstream error responses (non-2xx) are logged
 * with their body before the SDK consumes and discards it. Gemini returns its
 * real failure reason (e.g. `{"error":{"message":"The model is overloaded..."}}`)
 * in a small JSON body that the OpenAI SDK drops on some 5xx codes, leaving only
 * an opaque status — capturing it here is the only way to diagnose outages. The
 * body is read from a clone so the SDK still gets the original stream, truncated
 * to a bounded length, and only emitted for failures (no request/success bodies
 * are logged, so no email content is ever touched).
 */
function loggingFetch(
  fetchImpl: typeof undiciFetch,
  provider: string,
  model: string,
): typeof undiciFetch {
  return (async (input: Parameters<typeof undiciFetch>[0], init?: Parameters<typeof undiciFetch>[1]) => {
    const res = await fetchImpl(input, init);
    if (!res.ok) {
      let body = "";
      try {
        body = await res.clone().text();
      } catch {
        body = "(body unavailable)";
      }
      console.warn(
        `[llm] ${provider}/${model} upstream ${res.status} ${res.statusText}: ${body.slice(0, 500)}`,
      );
    }
    return res;
  }) as typeof undiciFetch;
}

/** Read an OpenAI-SDK error's HTTP status, or undefined for a non-HTTP error. */
function errorStatus(err: unknown): number | undefined {
  if (typeof err === "object" && err !== null && "status" in err) {
    const status = (err as { status?: unknown }).status;
    if (typeof status === "number") return status;
  }
  return undefined;
}

/** True for an OpenAI-SDK error (or compatible endpoint) that signals bad credentials. */
function isAuthError(err: unknown): boolean {
  return errorStatus(err) === 401;
}

/**
 * Deterministic client errors that will recur on an identical retry. 401 is
 * handled separately (LLMAuthenticationError); 408/429 are intentionally absent
 * because they are transient and should be retried.
 */
const DETERMINISTIC_REQUEST_ERROR_STATUSES = new Set([400, 403, 404, 422]);

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
      // The OpenAI SDK ships node-fetch@2.7.0, which mis-decodes gzipped chat
      // responses from Gemini's OpenAI-compat endpoint: the Gunzip stream closes
      // early and every call throws ERR_STREAM_PREMATURE_CLOSE ("Invalid response
      // body … Premature close"). Our Gemini embedding and Ollama paths use undici
      // fetch and are unaffected, so route the SDK through undici too. The SDK's
      // AbortController-based timeout/maxRetries still apply on top of this fetch.
      fetch: loggingFetch(undiciFetch, opts.provider, opts.model) as unknown as ClientOptions["fetch"],
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

  /**
   * Resolve the reasoning_effort to send for this provider. "none" is valid only
   * on Gemini's OpenAI-compat endpoint; OpenAI's enum is low|medium|high|minimal
   * and rejects "none" with a 400. So for non-Gemini providers, drop "none"
   * (omit the field) and pass low|medium|high through. Returns undefined when the
   * field should be omitted entirely.
   */
  private resolveReasoningEffort(): "low" | "medium" | "high" | "none" | undefined {
    if (!this.reasoningEffort) return undefined;
    if (this.reasoningEffort === "none" && this.providerName !== "gemini") return undefined;
    return this.reasoningEffort;
  }

  async chat(messages: Array<{ role: "system" | "user" | "assistant"; content: string }>): Promise<string> {
    let completion;
    const reasoningEffort = this.resolveReasoningEffort();
    try {
      completion = await this.client.chat.completions.create({
        model: this.modelName,
        messages,
        response_format: { type: "json_object" },
        // "none" is valid for Gemini's OpenAI-compat endpoint but absent from the
        // SDK's ReasoningEffort union ('low'|'medium'|'high'|null), so cast the
        // single field rather than loosening the whole call.
        ...(reasoningEffort
          ? { reasoning_effort: reasoningEffort as "low" | "medium" | "high" }
          : {}),
      });
    } catch (err) {
      if (isAuthError(err)) {
        const body = err instanceof Error ? err.message : String(err);
        throw new LLMAuthenticationError(this.providerName, this.modelName, body);
      }
      const status = errorStatus(err);
      if (status !== undefined && DETERMINISTIC_REQUEST_ERROR_STATUSES.has(status)) {
        const body = err instanceof Error ? err.message : String(err);
        throw new LLMRequestError(this.providerName, this.modelName, status, body);
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
