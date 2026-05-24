import { describe, it, expect } from "vitest";
import { selectCandidateNodes } from "../selection/candidate-selector.js";
import { selectNodeFromCandidates } from "../selection/select-path.js";
import { MIN_LLM_NODE_CONFIDENCE } from "../selection/validator.js";
import { ALL_NODES, ALL_EDGES, TEST_EMAILS } from "./fixtures/sorting-fixtures.js";
import type { AIProvider } from "../types.js";
import type { EmailInput } from "../selection/candidate-selector.js";
import type { ThreadMessage } from "../types.js";

// ─── Ollama availability check ────────────────────────────────────────────────

const OLLAMA_BASE_URL = process.env["OLLAMA_BASE_URL"] ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env["OLLAMA_MODEL"] ?? "llama3.2";

type OllamaTagsResponse = { models?: Array<{ name: string }> };

async function probeOllama(): Promise<{ available: boolean; reason: string }> {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return { available: false, reason: `HTTP ${res.status}` };

    const data = (await res.json()) as OllamaTagsResponse;
    const modelFound =
      data.models?.some(
        (m) => m.name === OLLAMA_MODEL || m.name.startsWith(`${OLLAMA_MODEL}:`)
      ) ?? false;

    if (!modelFound) {
      const listed = data.models?.map((m) => m.name).join(", ") || "none";
      return { available: false, reason: `model "${OLLAMA_MODEL}" not found (available: ${listed})` };
    }
    return { available: true, reason: "" };
  } catch (e) {
    return { available: false, reason: `unreachable — ${String(e)}` };
  }
}

const probe = await probeOllama();

if (!probe.available) {
  console.warn(
    `\n[sorting-llm] Skipping LLM tests: Ollama ${probe.reason}.\n` +
      `  Set OLLAMA_BASE_URL and OLLAMA_MODEL to enable (defaults: ${OLLAMA_BASE_URL}, ${OLLAMA_MODEL}).\n`
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toEmailInputs(messages: ThreadMessage[]): EmailInput[] {
  return messages.map((m) => ({
    ...(m.subject != null ? { subject: m.subject } : {}),
    senderEmail: m.senderEmail,
    ...(m.senderName != null ? { senderName: m.senderName } : {}),
    ...(m.bodyText != null ? { bodyText: m.bodyText } : {}),
  }));
}

// Temperature-0 provider for deterministic test results. Uses the Ollama chat
// endpoint directly (same as OllamaAIProvider) but adds options.temperature=0.
function makeOllamaProvider(baseUrl: string, model: string): AIProvider {
  return {
    providerName: "ollama",
    modelName: model,
    async chat(messages) {
      const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages, format: "json", stream: false, options: { temperature: 0 } }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "(no body)");
        throw new Error(`Ollama error ${res.status}: ${text}`);
      }
      const data = (await res.json()) as { message?: { content?: string } };
      const content = data?.message?.content;
      if (typeof content !== "string") throw new Error("Unexpected Ollama response shape");
      return content;
    },
  };
}

// ─── LLM sorting tests ────────────────────────────────────────────────────────

describe.skipIf(!probe.available)("LLM sorting — fixture emails (requires Ollama)", () => {
  const provider = makeOllamaProvider(OLLAMA_BASE_URL, OLLAMA_MODEL);

  for (const email of TEST_EMAILS) {
    it(
      `${email.id} (${email.difficulty}) → ${email.expectedFinalNodeId}`,
      async () => {
        const { candidates } = selectCandidateNodes(
          ALL_NODES,
          ALL_EDGES,
          toEmailInputs(email.messages)
        );
        expect(candidates.length).toBeGreaterThan(0);

        const result = await selectNodeFromCandidates(provider, email, candidates);

        if (email.allowNeedsHumanReview && result.needsHumanReview) {
          // Acceptable: LLM was uncertain and escalated to review.
          expect(result.finalNodeId).toBeNull();
          return;
        }

        // Confidently wrong classification is a failure.
        expect(result.needsHumanReview).toBe(false);
        expect(result.finalNodeId).toBe(email.expectedFinalNodeId);
        expect(result.confidence).toBeGreaterThanOrEqual(MIN_LLM_NODE_CONFIDENCE);
      },
      120_000 // local LLM can take 30–90 s for a 10-candidate prompt
    );
  }
});
