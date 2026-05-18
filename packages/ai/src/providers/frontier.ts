import OpenAI from "openai";
import type { AIProvider } from "../types.js";

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
    const completion = await this.client.chat.completions.create({
      model: this.modelName,
      messages,
      response_format: { type: "json_object" },
    });

    const content = completion.choices[0]?.message?.content;
    if (typeof content !== "string") {
      throw new Error("Frontier LLM returned no content");
    }
    return content;
  }
}
