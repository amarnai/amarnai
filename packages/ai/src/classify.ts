import { buildClassificationPrompt } from "./prompt.js";
import { parseAndValidateOutput } from "./validator.js";
import type { AIProvider, ClassifyInput, ClassifyOutput } from "./types.js";

export async function classifyThread(
  provider: AIProvider,
  input: ClassifyInput
): Promise<ClassifyOutput> {
  const messages = buildClassificationPrompt(input);
  const rawText = await provider.chat(messages);
  return parseAndValidateOutput(rawText, input.nodes, input.edges);
}
