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

export class FrontierAIProvider implements AIProvider {
  readonly providerName: string;
  readonly modelName: string;
  private readonly client: OpenAI;

  constructor(opts: { provider: string; apiKey: string; model: string; baseUrl?: string }) {
    this.providerName = opts.provider;
    this.modelName = opts.model;
    this.client = new OpenAI({
      apiKey: opts.apiKey,
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
