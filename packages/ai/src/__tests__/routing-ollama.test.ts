/**
 * End-to-end routing tests using live Ollama for both embeddings and LLM.
 *
 * Exercises the full sortThreadByEmbedding pipeline — embedding phase and
 * LLM disambiguation phase — on the labeled email fixtures. Skips automatically
 * when Ollama is not running or either required model is missing.
 *
 * To run locally:
 *   ollama pull qwen3-embedding
 *   ollama pull qwen3:14b   # or set OLLAMA_MODEL
 *   pnpm --filter @amarnai/ai test routing-ollama
 */
import { describe, it, expect, beforeAll } from "vitest";
import { sortThreadByEmbedding } from "../embedding/sorter.js";
import { OllamaEmbeddingProvider } from "../providers/embedding-ollama.js";
import {
  buildNodeEmbeddingText,
  deriveBreadcrumb,
  hashEmbeddingInput,
} from "../embedding/math.js";
import {
  ALL_NODES, ALL_EDGES, TEST_EMAILS,
  ALL_NODES_D3, ALL_EDGES_D3, TEST_EMAILS_D3,
} from "./fixtures/sorting-fixtures.js";
import type { AIProvider } from "../types.js";
import type { EmbeddableNode } from "../embedding/types.js";

// ─── Config ───────────────────────────────────────────────────────────────────

const OLLAMA_BASE_URL = process.env["OLLAMA_BASE_URL"] ?? "http://localhost:11434";
const OLLAMA_LLM_MODEL = process.env["OLLAMA_MODEL"] ?? "qwen3:14b";
const OLLAMA_EMBED_MODEL = process.env["OLLAMA_EMBEDDING_MODEL"] ?? "qwen3-embedding";

// ─── Availability probe ───────────────────────────────────────────────────────

type OllamaTagsResponse = { models?: Array<{ name: string }> };

async function probeOllama(): Promise<{ available: boolean; reason: string }> {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return { available: false, reason: `HTTP ${res.status}` };

    const data = (await res.json()) as OllamaTagsResponse;
    const names = data.models?.map((m) => m.name) ?? [];

    const hasModel = (wanted: string) =>
      names.some((n) => n === wanted || n.startsWith(`${wanted}:`));

    if (!hasModel(OLLAMA_LLM_MODEL)) {
      return {
        available: false,
        reason: `LLM model "${OLLAMA_LLM_MODEL}" not found (available: ${names.join(", ") || "none"})`,
      };
    }
    if (!hasModel(OLLAMA_EMBED_MODEL)) {
      return {
        available: false,
        reason: `embedding model "${OLLAMA_EMBED_MODEL}" not found (available: ${names.join(", ") || "none"})`,
      };
    }
    return { available: true, reason: "" };
  } catch (e) {
    return { available: false, reason: `unreachable — ${String(e)}` };
  }
}

const probe = await probeOllama();

if (!probe.available) {
  console.warn(
    `\n[routing-ollama] Skipping end-to-end routing tests: ${probe.reason}.\n` +
      `  Defaults: OLLAMA_BASE_URL=${OLLAMA_BASE_URL}, OLLAMA_MODEL=${OLLAMA_LLM_MODEL}, OLLAMA_EMBEDDING_MODEL=${OLLAMA_EMBED_MODEL}\n`
  );
}

// ─── Providers ────────────────────────────────────────────────────────────────

const embeddingProvider = new OllamaEmbeddingProvider(OLLAMA_BASE_URL, OLLAMA_EMBED_MODEL);

// Temperature-0 for deterministic LLM output.
const llmProvider: AIProvider = {
  providerName: "ollama",
  modelName: OLLAMA_LLM_MODEL,
  async chat(messages) {
    const res = await fetch(`${OLLAMA_BASE_URL.replace(/\/$/, "")}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_LLM_MODEL,
        messages,
        format: "json",
        stream: false,
        options: { temperature: 0 },
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "(no body)");
      throw new Error(`Ollama LLM error ${res.status}: ${text}`);
    }
    const data = (await res.json()) as { message?: { content?: string } };
    const content = data?.message?.content;
    if (typeof content !== "string") throw new Error("Unexpected Ollama response shape");
    return content;
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

import type { TaxonomyEdgeInput } from "../types.js";

async function preEmbedNodes(
  nodes: EmbeddableNode[],
  edges: TaxonomyEdgeInput[]
): Promise<void> {
  const stale = nodes.filter((n) => !n.isRoot && n.description != null);
  const texts = stale.map((n) => {
    const breadcrumb = deriveBreadcrumb(n.id, nodes, edges);
    return buildNodeEmbeddingText({ name: n.name, description: n.description!, breadcrumb });
  });
  const vectors = await embeddingProvider.embed(texts);
  stale.forEach((n, i) => {
    const text = texts[i]!;
    n.embeddingVector = vectors[i]!;
    n.embeddingModel = embeddingProvider.modelName;
    n.embeddingTextHash = hashEmbeddingInput(text, embeddingProvider.modelName);
  });
}

function routingSuite(
  label: string,
  nodes: EmbeddableNode[],
  edges: TaxonomyEdgeInput[],
  emails: typeof TEST_EMAILS
) {
  describe.skipIf(!probe.available)(label, () => {
    beforeAll(() => preEmbedNodes(nodes, edges), 60_000);

    for (const email of emails) {
      const title = `[${email.difficulty}] ${email.id} → ${email.expectedFinalNodeId}`;

      it(
        title,
        async () => {
          const result = await sortThreadByEmbedding(
            embeddingProvider,
            llmProvider,
            nodes,
            edges,
            email.messages
          );

          if (email.allowNeedsHumanReview) {
            const routedCorrectly = result.finalNodeId === email.expectedFinalNodeId;
            const deferredToHuman = result.needsHumanReview;
            expect(
              routedCorrectly || deferredToHuman,
              `Expected "${email.expectedFinalNodeId}" or needsHumanReview=true.\n` +
                `  Got: finalNodeId="${result.finalNodeId}" needsHumanReview=${result.needsHumanReview}\n` +
                `  Explanation: ${result.explanation}`
            ).toBe(true);
          } else {
            expect(result.finalNodeId, `Explanation: ${result.explanation}`).toBe(
              email.expectedFinalNodeId
            );
            expect(result.needsHumanReview).toBe(false);
          }
        },
        300_000
      );
    }
  });
}

// ─── Test suites ──────────────────────────────────────────────────────────────

routingSuite(
  `flat taxonomy — real embeddings (${OLLAMA_EMBED_MODEL}) + LLM (${OLLAMA_LLM_MODEL})`,
  ALL_NODES.map((n) => ({ ...n })),
  ALL_EDGES,
  TEST_EMAILS
);

routingSuite(
  `depth-3 personal/professional — real embeddings (${OLLAMA_EMBED_MODEL}) + LLM (${OLLAMA_LLM_MODEL})`,
  ALL_NODES_D3.map((n) => ({ ...n })),
  ALL_EDGES_D3,
  TEST_EMAILS_D3
);
