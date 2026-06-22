/**
 * Seed script for real embedding fixtures.
 *
 * Generates pre-computed Ollama vectors for all taxonomy nodes and test email
 * threads from sorting-fixtures.ts, then writes them to embedding-vectors.json.
 *
 * Usage:
 *   pnpm --filter @amarnai/ai seed:embeddings
 *
 * Requires Ollama running locally with qwen3-embedding (default) or the model
 * specified via OLLAMA_EMBEDDING_MODEL. Override the base URL with OLLAMA_BASE_URL.
 */
import { it, describe } from "vitest";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { OllamaEmbeddingProvider } from "../../providers/embedding-ollama.js";
import {
  buildNodeEmbeddingText,
  buildThreadEmbeddingText,
  deriveBreadcrumb,
} from "../../embedding/math.js";
import {
  ALL_NODES,
  ALL_EDGES,
  TEST_EMAILS,
  ALL_NODES_D2,
  ALL_EDGES_D2,
  D2_AMBIGUOUS_EMAIL,
  ALL_NODES_D3,
  ALL_EDGES_D3,
  TEST_EMAILS_D3,
} from "./sorting-fixtures.js";
import type { TaxonomyNodeInput, TaxonomyEdgeInput } from "../../types.js";

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_EMBEDDING_MODEL ?? "qwen3-embedding";

// Every taxonomy used by the test/benchmark fixtures. The reasoning benchmark
// routes emails from all three, so all of their node + thread texts must be
// embedded here or those emails skip (no fixture vector).
const DATASETS: Array<{
  nodes: TaxonomyNodeInput[];
  edges: TaxonomyEdgeInput[];
  emails: typeof TEST_EMAILS;
}> = [
  { nodes: ALL_NODES, edges: ALL_EDGES, emails: TEST_EMAILS },
  { nodes: ALL_NODES_D2, edges: ALL_EDGES_D2, emails: [D2_AMBIGUOUS_EMAIL] },
  { nodes: ALL_NODES_D3, edges: ALL_EDGES_D3, emails: TEST_EMAILS_D3 },
];

describe("seed embedding fixtures", () => {
  if (process.env.SEED_EMBEDDINGS !== "1") {
    it.skip("skipped — set SEED_EMBEDDINGS=1 to regenerate", () => {});
    return;
  }

  it("generates and writes embedding-vectors.json", async () => {
    const provider = new OllamaEmbeddingProvider(OLLAMA_BASE_URL, OLLAMA_MODEL);

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

    console.log(`Embedding ${textEntries.length} texts with ${OLLAMA_MODEL}…`);
    const vectors = await provider.embed(textEntries.map((e) => e.text));

    const entries = textEntries.map((entry, i) => ({
      key: entry.key,
      text: entry.text,
      vector: vectors[i]!,
    }));

    const outPath = join(dirname(fileURLToPath(import.meta.url)), "embedding-vectors.json");
    writeFileSync(
      outPath,
      JSON.stringify({ model: OLLAMA_MODEL, generatedAt: new Date().toISOString(), entries }, null, 2)
    );

    console.log(`Wrote ${entries.length} vectors → ${outPath}`);
  }, 120_000);
});
