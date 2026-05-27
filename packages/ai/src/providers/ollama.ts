import { Agent, fetch as undiciFetch } from "undici";
import type { AIProvider } from "../types.js";

type OllamaMessage = { role: string; content: string };

type OlamaChatResponse = {
  message?: { content?: string };
};

// Local LLMs can be very slow to produce the first response token, especially
// on a cold start or when multiple requests queue up behind a single Ollama
// worker. Five minutes is generous but avoids spurious timeouts under normal
// load. bodyTimeout is set to the same value so a slow streaming response
// also doesn't trip the limit before stream: false finishes.
const OLLAMA_TIMEOUT_MS = 5 * 60 * 1_000;

const ollamaAgent = new Agent({
  headersTimeout: OLLAMA_TIMEOUT_MS,
  bodyTimeout: OLLAMA_TIMEOUT_MS,
  connectTimeout: 10_000,
});

export class OllamaAIProvider implements AIProvider {
  readonly providerName = "ollama";
  readonly modelName: string;
  private readonly baseUrl: string;

  constructor(baseUrl: string, model: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.modelName = model;
  }

  async chat(messages: Array<{ role: "system" | "user" | "assistant"; content: string }>): Promise<string> {
    const ollamaMessages: OllamaMessage[] = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    let res: Awaited<ReturnType<typeof undiciFetch>>;
    try {
      res = await undiciFetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.modelName,
          messages: ollamaMessages,
          format: "json",
          stream: false,
        }),
        dispatcher: ollamaAgent,
      });
    } catch (err) {
      const code =
        err instanceof Error && err.cause && typeof err.cause === "object" && "code" in err.cause
          ? (err.cause as { code: string }).code
          : undefined;
      if (code === "ECONNREFUSED" || code === "UND_ERR_CONNECT_TIMEOUT") {
        throw new Error(
          `Ollama is not running at ${this.baseUrl} — start it with \`ollama serve\` or \`docker compose --profile local-ai up\``
        );
      }
      throw err;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "(no body)");
      throw new Error(`Ollama API error ${res.status}: ${text}`);
    }

    const data = (await res.json()) as OlamaChatResponse;
    const content = data?.message?.content;
    if (typeof content !== "string") {
      throw new Error("Ollama API returned unexpected response shape");
    }
    return content;
  }
}
