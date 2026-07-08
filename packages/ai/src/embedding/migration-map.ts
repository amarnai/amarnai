import { cosineSimilarity, meanVector, subtractVector } from "./math.js";

/**
 * Maps the folders of an outgoing taxonomy to the folders of an incoming one, so
 * that when a user replaces their taxonomy, threads sorted into a folder that has
 * a clear successor carry over instead of being re-sorted from scratch.
 *
 * Pure and deterministic: given the same node lists it returns the same map. All
 * embedding work (freshness, batch embed of the incoming folders) happens in the
 * caller; this function only compares the vectors it is handed. When a vector is
 * missing (mock embedding provider, or an un-embeddable node) the embedding rule
 * is skipped and matching falls back to catch-all + exact name.
 */

/** A candidate incoming folder for an outgoing folder, with its similarity. */
export type MigrationCandidate = { ref: string; sim: number };

export type MigrationSuggestion = {
  /** DB id of the outgoing (old) folder. */
  oldNodeId: string;
  /** Ref of the suggested incoming (new) folder, or null to re-sort with AI. */
  suggestedRef: string | null;
  /** How the suggestion was reached; null when no confident match was found. */
  matchKind: "catch_all" | "name" | "embedding" | null;
  /** Top incoming candidates by similarity, for the review dropdown ordering. */
  candidates: MigrationCandidate[];
};

export type MigrationOldNode = {
  id: string;
  name: string;
  isCatchAll: boolean;
  vector: number[] | null;
};

export type MigrationNewNode = {
  ref: string;
  name: string;
  isCatchAll: boolean;
  vector: number[] | null;
};

export type MigrationMapOptions = {
  /**
   * Minimum centered-cosine similarity of the top candidate to auto-map. Higher =
   * more conservative (more folders fall through to "re-sort with AI"). Tuned for
   * the production embedding model; self-host deployments may override.
   */
  simFloor?: number;
  /**
   * Minimum gap between the top-1 and top-2 centered-cosine similarity to
   * auto-map. Ensures the winner is clearly separated, not a near-tie.
   */
  simMargin?: number;
};

/**
 * Default auto-map thresholds on the mean-centered cosine similarity. Exported so
 * callers and tests share one source. A z-score rule is unusable here because the
 * max achievable z-score is bounded by sqrt(N-1), so it can never fire for the
 * common case of a handful of folders.
 */
export const MIGRATION_SIM_FLOOR = 0.3;
export const MIGRATION_SIM_MARGIN = 0.15;
/**
 * When the incoming taxonomy has a single embeddable folder, centering collapses
 * it to the zero vector, so fall back to a raw (uncentered) cosine floor.
 */
export const MIGRATION_RAW_SIM_FLOOR = 0.6;

/** Number of candidates surfaced per old folder for the review dropdown. */
const MAX_CANDIDATES = 3;

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Build the folder migration map. One suggestion per old node (the root is never
 * passed in). Rules, in order:
 *   1. Catch-all maps to the incoming catch-all, always, non-editable.
 *   2. Exact normalized name match to an incoming folder.
 *   3. Embedding match when the top candidate clears the similarity floor and
 *      beats the runner-up by a margin (skipped when vectors are missing — mock
 *      mode).
 *   4. Otherwise null (re-sort with AI).
 */
export function computeFolderMigrationMap(
  oldNodes: ReadonlyArray<MigrationOldNode>,
  newNodes: ReadonlyArray<MigrationNewNode>,
  opts: MigrationMapOptions = {}
): MigrationSuggestion[] {
  const simFloor = opts.simFloor ?? MIGRATION_SIM_FLOOR;
  const simMargin = opts.simMargin ?? MIGRATION_SIM_MARGIN;

  const newCatchAll = newNodes.find((n) => n.isCatchAll) ?? null;
  const nameToRef = new Map<string, string>();
  for (const n of newNodes) {
    if (n.isCatchAll) continue;
    // First writer wins; the transfer validator forbids duplicate names anyway.
    const key = normalizeName(n.name);
    if (!nameToRef.has(key)) nameToRef.set(key, n.ref);
  }

  // Mean-center by the incoming-folder centroid before comparing, matching the
  // sorter's anisotropy correction. Only real (non-catch-all) folders with a
  // vector participate — the catch-all is not a routing target. With a single
  // embeddable folder, centering collapses everything to the zero vector, so we
  // compare raw (uncentered) cosine and apply the raw floor instead.
  const embeddableNew = newNodes.filter((n) => !n.isCatchAll && n.vector != null && n.vector.length > 0);
  const singleFolder = embeddableNew.length === 1;
  const centroid = singleFolder ? [] : meanVector(embeddableNew.map((n) => n.vector as number[]));
  const centeredNew = embeddableNew.map((n) => ({
    ref: n.ref,
    // subtractVector is a no-op when centroid is [] (single-folder raw path).
    centered: subtractVector(n.vector as number[], centroid),
  }));

  return oldNodes.map((old): MigrationSuggestion => {
    // Rule 1: catch-all always maps to catch-all.
    if (old.isCatchAll) {
      return {
        oldNodeId: old.id,
        suggestedRef: newCatchAll?.ref ?? null,
        matchKind: newCatchAll ? "catch_all" : null,
        candidates: [],
      };
    }

    // Similarity to every incoming real folder, for candidate ordering. Empty
    // when either side lacks vectors (mock mode) — candidates stay [].
    let candidates: MigrationCandidate[] = [];
    if (old.vector != null && old.vector.length > 0 && centeredNew.length > 0) {
      const centeredOld = subtractVector(old.vector, centroid);
      candidates = centeredNew
        .map((n) => ({ ref: n.ref, sim: cosineSimilarity(centeredOld, n.centered) }))
        .sort((a, b) => b.sim - a.sim);
    }

    // Rule 2: exact name match wins over embedding (deterministic, and the only
    // signal available in mock mode).
    const nameRef = nameToRef.get(normalizeName(old.name));
    if (nameRef) {
      return {
        oldNodeId: old.id,
        suggestedRef: nameRef,
        matchKind: "name",
        candidates: candidates.slice(0, MAX_CANDIDATES),
      };
    }

    // Rule 3: confident, well-separated embedding winner. The top candidate must
    // clear an absolute similarity floor AND beat the runner-up by a margin, so a
    // near-tie falls through to re-sort rather than guessing.
    let suggestedRef: string | null = null;
    let matchKind: MigrationSuggestion["matchKind"] = null;
    if (candidates.length > 0) {
      const top1 = candidates[0]!.sim;
      const top2 = candidates.length > 1 ? candidates[1]!.sim : -Infinity;
      const floor = singleFolder ? MIGRATION_RAW_SIM_FLOOR : simFloor;
      if (top1 >= floor && top1 - top2 >= simMargin) {
        suggestedRef = candidates[0]!.ref;
        matchKind = "embedding";
      }
    }

    return {
      oldNodeId: old.id,
      suggestedRef,
      matchKind,
      candidates: candidates.slice(0, MAX_CANDIDATES),
    };
  });
}
