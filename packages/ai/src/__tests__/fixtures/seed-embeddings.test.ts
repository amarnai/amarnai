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
import { ALL_NODES, ALL_EDGES, TEST_EMAILS } from "./sorting-fixtures.js";

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_EMBEDDING_MODEL ?? "qwen3-embedding";

describe("seed embedding fixtures", () => {
  if (process.env.SEED_EMBEDDINGS !== "1") {
    it.skip("skipped — set SEED_EMBEDDINGS=1 to regenerate", () => {});
    return;
  }

  it("generates and writes embedding-vectors.json", async () => {
    const provider = new OllamaEmbeddingProvider(OLLAMA_BASE_URL, OLLAMA_MODEL);

    const textEntries: { key: string; text: string }[] = [];

    // Node embedding texts — must match exactly what sortThreadByEmbedding computes
    for (const node of ALL_NODES) {
      if (node.isRoot || !node.description) continue;
      const breadcrumb = deriveBreadcrumb(node.id, ALL_NODES, ALL_EDGES);
      const text = buildNodeEmbeddingText({
        name: node.name,
        description: node.description,
        breadcrumb,
      });
      textEntries.push({ key: `node:${node.id}`, text });
    }

    // Thread embedding texts — must match exactly what sortThreadByEmbedding computes
    for (const email of TEST_EMAILS) {
      const text = buildThreadEmbeddingText(
        email.messages.map((m) => ({ subject: m.subject, bodyText: m.bodyText }))
      );
      textEntries.push({ key: `thread:${email.id}`, text });
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
