/**
 * Seed script for real embedding fixtures.
 *
 * Generates pre-computed vectors for all taxonomy nodes and test email threads
 * from sorting-fixtures.ts, then writes them to a per-model file
 * (embedding-vectors.<model>.json) so the grid search can be judged on the
 * model actually deployed (Gemini) while keeping qwen3 as an offline default.
 *
 * Usage:
 *   pnpm --filter @amarnai/ai seed:embeddings            (default: qwen3 via Ollama)
 *
 *   EMBEDDING_PROVIDER=frontier \
 *   FRONTIER_EMBEDDING_PROVIDER=gemini \
 *   FRONTIER_EMBEDDING_MODEL=gemini-embedding-001 \
 *   FRONTIER_EMBEDDING_API_KEY=… \
 *   pnpm --filter @amarnai/ai seed:embeddings            (Gemini)
 *
 * The provider is resolved from the env-driven factory (getEmbeddingProviderConfig
 * + createEmbeddingProvider) exactly like the runtime sorter, so seeded vectors
 * match production. When EMBEDDING_PROVIDER is unset it defaults to Ollama
 * qwen3-embedding at localhost:11434, preserving keyless local seeding.
 */
import { it, describe } from "vitest";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createEmbeddingProvider } from "../../providers/create-embedding.js";
import { getEmbeddingProviderConfig } from "../../config.js";
import { fixtureFileForModel } from "./real-embedding-table.js";
import {
  buildNodeEmbeddingText,
  buildThreadEmbeddingText,
  deriveBreadcrumb,
} from "../../embedding/math.js";
import {
  ALL_NODES,
  ALL_EDGES,
  TEST_EMAILS,
  TEST_EMAILS_INTL,
  ALL_NODES_D2,
  ALL_EDGES_D2,
  D2_AMBIGUOUS_EMAIL,
  ALL_NODES_D3,
  ALL_EDGES_D3,
  TEST_EMAILS_D3,
  ALL_NODES_FM,
  ALL_EDGES_FM,
  TEST_EMAILS_FM,
  ALL_NODES_ORIGIN,
  ALL_EDGES_ORIGIN,
  TEST_EMAILS_ORIGIN,
} from "./sorting-fixtures.js";
import { ML_FLAT, ML_D3 } from "./multilingual/index.js";
import type { TaxonomyNodeInput, TaxonomyEdgeInput } from "../../types.js";
import type { EmbeddingProviderConfig } from "../../embedding/types.js";

/**
 * Resolve the embedding provider config for seeding. When EMBEDDING_PROVIDER is
 * explicitly set, use the runtime factory config (supports Gemini/OpenAI/Ollama).
 * Otherwise default to Ollama qwen3 so local seeding works without any API key
 * or env setup — the historical behaviour.
 */
function resolveSeedConfig(): EmbeddingProviderConfig {
  if (process.env.EMBEDDING_PROVIDER) return getEmbeddingProviderConfig();
  return {
    provider: "ollama",
    ollama: {
      baseUrl: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
      model: process.env.OLLAMA_EMBEDDING_MODEL ?? "qwen3-embedding",
    },
  };
}

// Every taxonomy used by the test/benchmark fixtures. The reasoning benchmark
// routes emails from all three, so all of their node + thread texts must be
// embedded here or those emails skip (no fixture vector).
const DATASETS: Array<{
  nodes: TaxonomyNodeInput[];
  edges: TaxonomyEdgeInput[];
  emails: typeof TEST_EMAILS;
}> = [
  { nodes: ALL_NODES, edges: ALL_EDGES, emails: TEST_EMAILS },
  { nodes: ALL_NODES, edges: ALL_EDGES, emails: TEST_EMAILS_INTL },
  // B6 multilingual sets (100 threads, 16 locales).
  { nodes: ALL_NODES, edges: ALL_EDGES, emails: ML_FLAT },
  { nodes: ALL_NODES_D3, edges: ALL_EDGES_D3, emails: ML_D3 },
  { nodes: ALL_NODES_D2, edges: ALL_EDGES_D2, emails: [D2_AMBIGUOUS_EMAIL] },
  { nodes: ALL_NODES_D3, edges: ALL_EDGES_D3, emails: TEST_EMAILS_D3 },
  { nodes: ALL_NODES_FM, edges: ALL_EDGES_FM, emails: TEST_EMAILS_FM },
  { nodes: ALL_NODES_ORIGIN, edges: ALL_EDGES_ORIGIN, emails: TEST_EMAILS_ORIGIN },
];

describe("seed embedding fixtures", () => {
  if (process.env.SEED_EMBEDDINGS !== "1") {
    it.skip("skipped — set SEED_EMBEDDINGS=1 to regenerate", () => {});
    return;
  }

  it("generates and writes the per-model embedding fixture", async () => {
    const provider = createEmbeddingProvider(resolveSeedConfig());
    const model = provider.modelName;

    const textEntries: { key: string; text: string }[] = [];
    const seenText = new Set<string>();
    const add = (key: string, text: string) => {
      // The loader maps by text, so de-dupe identical texts across taxonomies.
      if (seenText.has(text)) return;
      seenText.add(text);
      textEntries.push({ key, text });
    };

    for (const { nodes, edges, emails } of DATASETS) {
      // Node embedding texts — must match exactly what sortThreadByEmbedding computes.
      // Breadcrumb must be derived within the node's own taxonomy.
      for (const node of nodes) {
        if (node.isRoot || !node.description) continue;
        const breadcrumb = deriveBreadcrumb(node.id, nodes, edges);
        add(
          `node:${node.id}`,
          buildNodeEmbeddingText({ name: node.name, description: node.description, breadcrumb })
        );
      }

      // Thread embedding texts — must match exactly what sortThreadByEmbedding computes.
      for (const email of emails) {
        add(
          `thread:${email.id}`,
          buildThreadEmbeddingText(
            email.messages.map((m) => ({ subject: m.subject, bodyText: m.bodyText }))
          )
        );
      }
    }

    console.log(`Embedding ${textEntries.length} texts with ${model}…`);
    const vectors = await provider.embed(textEntries.map((e) => e.text));

    const entries = textEntries.map((entry, i) => ({
      key: entry.key,
      text: entry.text,
      vector: vectors[i]!,
    }));

    const outPath = join(dirname(fileURLToPath(import.meta.url)), fixtureFileForModel(model));
    writeFileSync(
      outPath,
      JSON.stringify({ model, generatedAt: new Date().toISOString(), entries }, null, 2)
    );

    console.log(`Wrote ${entries.length} vectors → ${outPath}`);
  }, 120_000);
});
