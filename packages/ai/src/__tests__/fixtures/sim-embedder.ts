/**
 * Constructs an EmbeddingProvider whose cosine similarities are specified
 * directly from a `sims` table, without real embeddings.
 *
 * ## How it works
 *
 * Each non-root node is assigned an orthonormal basis vector e_i in R^(N+1).
 * The thread vector is set to [s_1, ..., s_N, r] where s_i is the desired
 * cosine similarity with node i and r = sqrt(max(0, 1 - Σ s_i²)) ensures
 * unit length.
 *
 * Since both vectors are unit length:
 *   cos_sim(thread, e_i) = dot(thread, e_i) = thread[i] = s_i  ✓
 *
 * Constraint: Σ s_i² ≤ 1. When violated (e.g. many nodes each with s=0.7),
 * similarities are proportionally scaled to fit the unit sphere. Relative
 * ordering is preserved.
 */

import {
  buildNodeEmbeddingText,
  buildThreadEmbeddingText,
  deriveBreadcrumb,
} from "../../embedding/math.js";
import type { EmbeddingProvider } from "../../embedding/types.js";
import type { TaxonomyNodeInput, TaxonomyEdgeInput, ThreadMessage } from "../../types.js";

/**
 * Build an embedding text → vector lookup table that produces the desired
 * cosine similarities when the sorter calls cosineSimilarity().
 */
export function buildSimTable(
  nodes: readonly TaxonomyNodeInput[],
  edges: readonly TaxonomyEdgeInput[],
  sims: Record<string, number>,
  messages: ThreadMessage[]
): ReadonlyMap<string, number[]> {
  const nonRoot = nodes.filter((n) => !n.isRoot && n.description != null);
  const dim = nonRoot.length + 1; // +1 residual dimension
  const table = new Map<string, number[]>();

  // Assign orthonormal basis vector e_i to each non-root node
  nonRoot.forEach((n, i) => {
    const breadcrumb = deriveBreadcrumb(n.id, nodes, edges);
    const text = buildNodeEmbeddingText({
      name: n.name,
      description: n.description!,
      breadcrumb,
    });
    const vec = new Array<number>(dim).fill(0);
    vec[i] = 1;
    table.set(text, vec);
  });

  // Build thread vector with desired similarities
  const msgSlice = messages.map((m) => ({ subject: m.subject, bodyText: m.bodyText }));
  const threadText = buildThreadEmbeddingText(msgSlice);

  const desired = nonRoot.map((n) => sims[n.id] ?? 0);
  const sumSqr = desired.reduce((acc, s) => acc + s * s, 0);

  const threadVec = new Array<number>(dim).fill(0);
  if (sumSqr > 1) {
    // Scale down proportionally — relative ordering is preserved
    const scale = 1 / Math.sqrt(sumSqr);
    desired.forEach((s, i) => { threadVec[i] = s * scale; });
    threadVec[dim - 1] = 0;
  } else {
    desired.forEach((s, i) => { threadVec[i] = s; });
    threadVec[dim - 1] = Math.sqrt(1 - sumSqr);
  }

  table.set(threadText, threadVec);
  return table;
}

/** EmbeddingProvider backed by a pre-built similarity table. */
export function makeSimEmbedder(
  table: ReadonlyMap<string, number[]>
): EmbeddingProvider {
  const dim = [...table.values()][0]?.length ?? 16;
  return {
    providerName: "sim-mock",
    modelName: "sim-v1",
    async embed(texts: string[]): Promise<number[][]> {
      return texts.map((t) => table.get(t) ?? new Array<number>(dim).fill(0));
    },
  };
}
