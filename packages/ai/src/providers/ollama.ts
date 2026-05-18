import type { AIProvider } from "../types.js";

type OllamaMessage = { role: string; content: string };

type OlamaChatResponse = {
  message?: { content?: string };
};

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

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.modelName,
        messages: ollamaMessages,
        format: "json",
        stream: false,
      }),
    });

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
