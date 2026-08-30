/**
 * Backfill / refresh: recompute stale or missing taxonomy node embeddings for
 * every workspace. Safe to run multiple times — only nodes whose stored
 * `embeddingTextHash` does not match the current embedding input (breadcrumb +
 * name + description + model) are re-embedded.
 *
 * Environment variables required (same as the API):
 *   EMBEDDING_PROVIDER           — "frontier" | "ollama"
 *   FRONTIER_EMBEDDING_PROVIDER  — (if provider=frontier, e.g. "gemini" or "openai")
 *   FRONTIER_EMBEDDING_API_KEY   — (if provider=frontier)
 *   FRONTIER_EMBEDDING_MODEL     — (if provider=frontier)
 *   FRONTIER_EMBEDDING_BASE_URL  — (if provider=frontier with a custom OpenAI-compatible endpoint)
 *   FRONTIER_EMBEDDING_DIMENSIONS — (optional output vector size, e.g. 768; must
 *                                   match the value used by the API/worker)
 *   OLLAMA_BASE_URL              — (if provider=ollama)
 *   OLLAMA_EMBEDDING_MODEL       — (if provider=ollama, default: qwen3-embedding)
 *
 * Usage:
 *   pnpm --filter @aziru/db embeddings:refresh-taxonomy
 */

import { PrismaClient } from "@prisma/client";
import {
  createEmbeddingProvider,
  buildNodeEmbeddingText,
  deriveBreadcrumb,
  hashEmbeddingInput,
  getStaleEmbeddableNodes,
} from "@aziru/ai";
import type { EmbeddingProviderConfig, EmbeddableNode } from "@aziru/ai";

const db = new PrismaClient();

// ─── Provider config from environment ────────────────────────────────────────

function getEmbeddingConfig(): EmbeddingProviderConfig {
  const raw = process.env["EMBEDDING_PROVIDER"];
  if (!raw || (raw !== "frontier" && raw !== "ollama")) {
    throw new Error(
      "EMBEDDING_PROVIDER must be set to 'frontier' or 'ollama'. " +
        "Example: EMBEDDING_PROVIDER=ollama pnpm --filter @aziru/db embeddings:refresh-taxonomy"
    );
  }
  const cfg: EmbeddingProviderConfig = { provider: raw };
  const fProvider = process.env["FRONTIER_EMBEDDING_PROVIDER"];
  const fApiKey = process.env["FRONTIER_EMBEDDING_API_KEY"];
  const fModel = process.env["FRONTIER_EMBEDDING_MODEL"];
  const fBaseUrl = process.env["FRONTIER_EMBEDDING_BASE_URL"];
  const fDimsRaw = process.env["FRONTIER_EMBEDDING_DIMENSIONS"];
  const fDims = fDimsRaw ? Number(fDimsRaw) : undefined;
  const fDimensions = fDims && Number.isInteger(fDims) && fDims > 0 ? fDims : undefined;
  if (fProvider ?? fApiKey ?? fModel ?? fBaseUrl ?? fDimensions) {
    cfg.frontier = {
      ...(fProvider ? { provider: fProvider } : {}),
      ...(fApiKey ? { apiKey: fApiKey } : {}),
      ...(fModel ? { model: fModel } : {}),
      ...(fBaseUrl ? { baseUrl: fBaseUrl } : {}),
      ...(fDimensions ? { dimensions: fDimensions } : {}),
    };
  }
  const ollamaBase = process.env["OLLAMA_BASE_URL"];
  const ollamaModel = process.env["OLLAMA_EMBEDDING_MODEL"];
  if (ollamaBase ?? ollamaModel) {
    cfg.ollama = {
      ...(ollamaBase ? { baseUrl: ollamaBase } : {}),
      ...(ollamaModel ? { model: ollamaModel } : {}),
    };
  }
  return cfg;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const embeddingProvider = createEmbeddingProvider(getEmbeddingConfig());
  console.log(`Embedding model: ${embeddingProvider.modelName}`);

  const workspaces = await db.workspace.findMany({
    select: { id: true, name: true },
  });
  console.log(`Found ${workspaces.length} workspace(s).`);

  let totalRefreshed = 0;
  let totalSkipped = 0;

  for (const ws of workspaces) {
    const [rawNodes, rawEdges] = await Promise.all([
      db.taxonomyNode.findMany({
        where: { workspaceId: ws.id },
        select: {
          id: true,
          name: true,
          description: true,
          instructions: true,
          examples: true,
          isRoot: true,
          embeddingVector: true,
          embeddingModel: true,
          embeddingTextHash: true,
        },
      }),
      db.taxonomyEdge.findMany({
        where: { workspaceId: ws.id },
        select: { id: true, sourceNodeId: true, targetNodeId: true },
      }),
    ]);

    const nodes: EmbeddableNode[] = rawNodes.map((n) => ({
      ...n,
      examples: n.examples as string[],
      embeddingVector: n.embeddingVector.length > 0 ? n.embeddingVector : null,
    }));

    const staleNodes = getStaleEmbeddableNodes(nodes, rawEdges, embeddingProvider.modelName);

    if (staleNodes.length === 0) {
      console.log(`  "${ws.name}": all ${nodes.length} node(s) current — nothing to refresh.`);
      totalSkipped += nodes.filter((n) => !n.isRoot && n.description != null).length;
      continue;
    }

    const freshCount = nodes.filter((n) => !n.isRoot && n.description != null).length - staleNodes.length;
    console.log(
      `  "${ws.name}": ${staleNodes.length} stale/missing, ${freshCount} current — refreshing…`
    );

    // Build embedding texts for all stale nodes
    const texts = staleNodes.map((n) => {
      const breadcrumb = deriveBreadcrumb(n.id, nodes, rawEdges);
      return buildNodeEmbeddingText({ name: n.name, description: n.description!, breadcrumb });
    });

    // Embed in one batch call
    const vectors = await embeddingProvider.embed(texts);

    // Persist each refreshed embedding
    await Promise.all(
      staleNodes.map((n, i) => {
        const breadcrumb = deriveBreadcrumb(n.id, nodes, rawEdges);
        const text = buildNodeEmbeddingText({ name: n.name, description: n.description!, breadcrumb });
        const textHash = hashEmbeddingInput(text, embeddingProvider.modelName);
        return db.taxonomyNode.update({
          where: { id: n.id },
          data: {
            embeddingVector: vectors[i]!,
            embeddingModel: embeddingProvider.modelName,
            embeddingTextHash: textHash,
            embeddingUpdatedAt: new Date(),
          },
        });
      })
    );

    console.log(`    ✓ Refreshed ${staleNodes.length} node(s).`);
    totalRefreshed += staleNodes.length;
    totalSkipped += freshCount;
  }

  console.log(
    `\nDone. Refreshed ${totalRefreshed} node embedding(s), skipped ${totalSkipped} already-current.`
  );
}

main()
  .catch((err) => {
    console.error("Refresh failed:", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
