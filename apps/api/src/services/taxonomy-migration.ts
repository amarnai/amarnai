import { db } from "@amarnai/db";
import {
  createEmbeddingProvider,
  getEmbeddingProviderConfig,
  computeFolderMigrationMap,
  buildNodeEmbeddingText,
  deriveBreadcrumb,
  hashEmbeddingInput,
  type MigrationSuggestion,
} from "@amarnai/ai";
import type { TaxonomyTransferFile } from "@amarnai/shared";

/** One old folder's migration suggestion, enriched with display data for the UI. */
export type MigrationPreviewRow = MigrationSuggestion & {
  oldName: string;
  isCatchAll: boolean;
  /** Number of threads currently sorted into this old folder (latest classification). */
  threadCount: number;
};

export type MigrationPreview = {
  suggestions: MigrationPreviewRow[];
  /** Threads under auto-mapped folders — carried over instantly, no AI cost. */
  migrateCount: number;
  /** Threads that will be re-sorted by AI (unmapped folders + review/unclassified). */
  resortCount: number;
};

/** Latest-classification folder + status per thread, from a single DISTINCT ON scan. */
type LatestRow = { emailThreadId: string; finalNodeId: string | null; triageStatus: string };

/**
 * Latest classification (by createdAt) for every thread in the workspace that has
 * one, joined to its current triage status. This is the authoritative "where does
 * each thread live now" — the per-node counts in taxonomy-nodes.ts count ALL
 * historical rows and would over-count re-sorted threads.
 */
export async function latestClassificationsByThread(workspaceId: string): Promise<LatestRow[]> {
  return db.$queryRaw<LatestRow[]>`
    SELECT sub."emailThreadId", sub."finalNodeId", t."triageStatus"::text AS "triageStatus"
    FROM (
      SELECT DISTINCT ON ("emailThreadId") "emailThreadId", "finalNodeId"
      FROM "EmailClassification"
      WHERE "workspaceId" = ${workspaceId}
      ORDER BY "emailThreadId", "createdAt" DESC
    ) sub
    JOIN "EmailThread" t ON t.id = sub."emailThreadId"
  `;
}

/**
 * Compute the folder migration preview for replacing the workspace taxonomy with
 * `file`. Re-embeds any stale old-folder vectors on the fly (never persisted —
 * the nodes are about to be deleted) and embeds the incoming folders once. In
 * mock-embedding mode, vectors are skipped and matching degrades to catch-all +
 * exact name.
 */
export async function computeMigrationPreview(
  workspaceId: string,
  file: TaxonomyTransferFile
): Promise<MigrationPreview> {
  const [oldNodes, oldEdges, latest] = await Promise.all([
    db.taxonomyNode.findMany({
      where: { workspaceId, isRoot: false },
      select: {
        id: true,
        name: true,
        description: true,
        isRoot: true,
        isCatchAll: true,
        embeddingVector: true,
        embeddingModel: true,
        embeddingTextHash: true,
      },
    }),
    db.taxonomyEdge.findMany({
      where: { workspaceId },
      select: { id: true, sourceNodeId: true, targetNodeId: true },
    }),
    latestClassificationsByThread(workspaceId),
  ]);

  // Thread counts per old folder (latest classification only).
  const threadCountByNode = new Map<string, number>();
  for (const row of latest) {
    if (row.finalNodeId == null) continue;
    threadCountByNode.set(row.finalNodeId, (threadCountByNode.get(row.finalNodeId) ?? 0) + 1);
  }

  const embConfig = getEmbeddingProviderConfig();
  const useMock = embConfig.provider === "mock";
  const embeddingProvider = useMock ? null : createEmbeddingProvider(embConfig);
  const modelName = embeddingProvider?.modelName ?? "";

  // ── Old-folder vectors: reuse the fresh cache, re-embed the stale ones ──────
  // Node rows for breadcrumb derivation include a synthetic root so paths render
  // as "Inbox > …" identically to the sorter.
  const rootRow = { id: "__root__", name: "Inbox", isRoot: true };
  const oldNodeRows = [rootRow, ...oldNodes.map((n) => ({ id: n.id, name: n.name, isRoot: false }))];

  const oldVectors = new Map<string, number[] | null>();
  const staleTexts: { id: string; text: string }[] = [];
  for (const n of oldNodes) {
    if (useMock || n.description == null) {
      oldVectors.set(n.id, null);
      continue;
    }
    const breadcrumb = deriveBreadcrumb(n.id, oldNodeRows, oldEdges);
    const text = buildNodeEmbeddingText({ name: n.name, description: n.description, breadcrumb });
    const fresh =
      n.embeddingVector.length > 0 &&
      n.embeddingModel === modelName &&
      n.embeddingTextHash === hashEmbeddingInput(text, modelName);
    if (fresh) {
      oldVectors.set(n.id, n.embeddingVector);
    } else {
      oldVectors.set(n.id, null); // filled by the batch embed below
      staleTexts.push({ id: n.id, text });
    }
  }
  if (embeddingProvider && staleTexts.length > 0) {
    const vectors = await embeddingProvider.embed(staleTexts.map((s) => s.text));
    staleTexts.forEach((s, i) => {
      const v = vectors[i];
      oldVectors.set(s.id, v && v.length > 0 ? v : null);
    });
  }

  // ── Incoming-folder vectors: embed the file's non-root folders once ─────────
  const newNonRoot = file.nodes.filter((n) => !n.isRoot);
  const newNodeRows = file.nodes.map((n) => ({ id: n.ref, name: n.name, isRoot: n.isRoot }));
  const newEdgeRows = file.edges.map((e) => ({
    id: `${e.sourceRef}:${e.targetRef}`,
    sourceNodeId: e.sourceRef,
    targetNodeId: e.targetRef,
  }));

  const newVectors = new Map<string, number[] | null>();
  if (embeddingProvider) {
    const texts = newNonRoot.map((n) => {
      const breadcrumb = deriveBreadcrumb(n.ref, newNodeRows, newEdgeRows);
      return buildNodeEmbeddingText({
        name: n.name,
        description: n.description ?? "",
        breadcrumb,
      });
    });
    const vectors = texts.length > 0 ? await embeddingProvider.embed(texts) : [];
    newNonRoot.forEach((n, i) => {
      const v = vectors[i];
      newVectors.set(n.ref, v && v.length > 0 ? v : null);
    });
  } else {
    for (const n of newNonRoot) newVectors.set(n.ref, null);
  }

  const suggestions = computeFolderMigrationMap(
    oldNodes.map((n) => ({
      id: n.id,
      name: n.name,
      isCatchAll: n.isCatchAll,
      vector: oldVectors.get(n.id) ?? null,
    })),
    newNonRoot.map((n) => ({
      ref: n.ref,
      name: n.name,
      isCatchAll: n.isCatchAll ?? false,
      vector: newVectors.get(n.ref) ?? null,
    }))
  );

  const oldById = new Map(oldNodes.map((n) => [n.id, n]));
  const rows: MigrationPreviewRow[] = suggestions.map((s) => {
    const old = oldById.get(s.oldNodeId)!;
    return {
      ...s,
      oldName: old.name,
      isCatchAll: old.isCatchAll,
      threadCount: threadCountByNode.get(s.oldNodeId) ?? 0,
    };
  });

  // migrateCount: threads under a folder with a concrete suggested target.
  // resortCount: threads under an unmapped folder, plus all review/unclassified
  // threads (recomputed authoritatively at apply time; this is the estimate).
  let migrateCount = 0;
  const mappedNodeIds = new Set<string>();
  for (const r of rows) {
    if (r.suggestedRef != null) {
      migrateCount += r.threadCount;
      mappedNodeIds.add(r.oldNodeId);
    }
  }
  let resortCount = 0;
  for (const row of latest) {
    const status = row.triageStatus;
    if (status === "NEEDS_REVIEW" || status === "UNCLASSIFIED") {
      resortCount++;
    } else if (status === "SORTED" && (row.finalNodeId == null || !mappedNodeIds.has(row.finalNodeId))) {
      resortCount++;
    }
  }

  return { suggestions: rows, migrateCount, resortCount };
}
