import { z } from "zod";
import { nodeNameSchema, nodeDescriptionSchema } from "./taxonomy.js";
import type { TaxonomyNode, TaxonomyEdge } from "./taxonomy.js";
import { MAX_TAXONOMY_NON_ROOT_NODES } from "../taxonomy-routable.js";

// ─── Constants ────────────────────────────────────────────────────────────────

export const TAXONOMY_TRANSFER_VERSION = 1 as const;

export const MAX_TAXONOMY_TRANSFER_NODES = 300;
export const MAX_TAXONOMY_TRANSFER_EDGES = 600;
export const MAX_EXAMPLES_PER_NODE = 20;
export const MAX_EXAMPLE_LENGTH = 500;

const HTML_TAG_RE = /<[a-zA-Z][^>]*>/;

const transferTextField = (max: number) =>
  z
    .string()
    .max(max)
    .refine((v) => !HTML_TAG_RE.test(v), "Must be plain text (no HTML)");

// ─── Transfer node & edge schemas ─────────────────────────────────────────────

export const TaxonomyTransferNodeSchema = z.object({
  ref: z.string().min(1),
  name: z.string().min(1).max(100).refine((v) => !HTML_TAG_RE.test(v), "Must be plain text (no HTML)"),
  description: z.string().max(500).nullable(),
  instructions: transferTextField(2000).nullable(),
  draftPrompt: transferTextField(500).nullable(),
  examples: z
    .array(transferTextField(MAX_EXAMPLE_LENGTH))
    .max(MAX_EXAMPLES_PER_NODE),
  isRoot: z.boolean(),
  /** A non-routable catch-all destination ("Updates / Other"). Optional for back-compat. */
  isCatchAll: z.boolean().optional(),
  positionX: z.number().finite(),
  positionY: z.number().finite(),
});
export type TaxonomyTransferNode = z.infer<typeof TaxonomyTransferNodeSchema>;

export const TaxonomyTransferEdgeSchema = z.object({
  sourceRef: z.string().min(1),
  targetRef: z.string().min(1),
});
export type TaxonomyTransferEdge = z.infer<typeof TaxonomyTransferEdgeSchema>;

export const TaxonomyTransferFileSchema = z.object({
  aziruTaxonomyVersion: z.literal(TAXONOMY_TRANSFER_VERSION),
  exportedAt: z.string().datetime(),
  nodes: z.array(TaxonomyTransferNodeSchema).min(1).max(MAX_TAXONOMY_TRANSFER_NODES),
  edges: z.array(TaxonomyTransferEdgeSchema).max(MAX_TAXONOMY_TRANSFER_EDGES),
});
export type TaxonomyTransferFile = z.infer<typeof TaxonomyTransferFileSchema>;

// ─── Import request (file + optional folder migration mapping) ─────────────────

/**
 * Sentinel value in a migration mapping meaning "do not carry this folder's
 * threads over; re-sort them with AI against the new taxonomy".
 */
export const MIGRATION_RESORT = "resort" as const;

/**
 * Body accepted by the taxonomy-import apply route. Two shapes:
 *   - a bare TaxonomyTransferFile (legacy / no mapping) — every sorted thread is
 *     re-sorted, matching the pre-migration behavior.
 *   - { file, mapping } — `mapping` carries old DB node id → new folder `ref`
 *     (migrate those threads instantly) or the `"resort"` sentinel (re-sort with
 *     AI). Old folders absent from the mapping are treated as `"resort"`.
 */
export const TaxonomyImportRequestSchema = z.union([
  TaxonomyTransferFileSchema,
  z.object({
    file: TaxonomyTransferFileSchema,
    mapping: z.record(z.string(), z.union([z.string().min(1), z.literal(MIGRATION_RESORT)])),
  }),
]);
export type TaxonomyImportRequest = z.infer<typeof TaxonomyImportRequestSchema>;

/** Normalize either import-request shape into { file, mapping }. */
export function normalizeTaxonomyImportRequest(
  req: TaxonomyImportRequest
): { file: TaxonomyTransferFile; mapping: Record<string, string> } {
  if ("file" in req) return { file: req.file, mapping: req.mapping };
  return { file: req, mapping: {} };
}

// ─── Cycle detection (refs) ───────────────────────────────────────────────────

function hasCycleInRefs(edges: TaxonomyTransferEdge[]): boolean {
  const adj = new Map<string, string[]>();
  for (const edge of edges) {
    const list = adj.get(edge.sourceRef) ?? [];
    list.push(edge.targetRef);
    adj.set(edge.sourceRef, list);
  }

  const visited = new Set<string>();
  const stack = new Set<string>();

  function dfs(node: string): boolean {
    if (stack.has(node)) return true;
    if (visited.has(node)) return false;
    visited.add(node);
    stack.add(node);
    for (const neighbor of adj.get(node) ?? []) {
      if (dfs(neighbor)) return true;
    }
    stack.delete(node);
    return false;
  }

  for (const node of adj.keys()) {
    if (dfs(node)) return true;
  }
  return false;
}

// ─── Deep structural validator ────────────────────────────────────────────────

export type TaxonomyTransferValidationResult =
  | { ok: true; data: TaxonomyTransferFile }
  | { ok: false; error: string };

export function validateTaxonomyTransfer(
  file: TaxonomyTransferFile
): TaxonomyTransferValidationResult {
  const { nodes, edges } = file;

  // Duplicate refs
  const refs = new Set<string>();
  for (const node of nodes) {
    if (refs.has(node.ref)) {
      return { ok: false, error: `Duplicate folder ref: "${node.ref}"` };
    }
    refs.add(node.ref);
  }

  // Exactly one root
  const rootNodes = nodes.filter((n) => n.isRoot);
  if (rootNodes.length === 0) {
    return { ok: false, error: "Taxonomy must have exactly one root folder (Inbox)" };
  }
  if (rootNodes.length > 1) {
    return { ok: false, error: "Taxonomy must have exactly one root folder. Found multiple." };
  }
  const rootRef = rootNodes[0]!.ref;

  // Enforce the product folder cap (distinct from the schema's 300-node parse
  // bound). Counts every non-root node, matching interactive create enforcement.
  const nonRootCount = nodes.length - rootNodes.length;
  if (nonRootCount > MAX_TAXONOMY_NON_ROOT_NODES) {
    return {
      ok: false,
      error: `Taxonomy has too many folders (${nonRootCount}). The maximum is ${MAX_TAXONOMY_NON_ROOT_NODES}.`,
    };
  }

  // Validate non-root node fields with strict input rules
  for (const node of nodes) {
    if (node.isRoot) continue;

    const nameResult = nodeNameSchema.safeParse(node.name);
    if (!nameResult.success) {
      return {
        ok: false,
        error: `Folder "${node.name}": ${nameResult.error.issues[0]?.message ?? "invalid name"}`,
      };
    }

    if (!node.description) {
      return {
        ok: false,
        error: `Folder "${node.name}": description is required`,
      };
    }

    const descResult = nodeDescriptionSchema.safeParse(node.description);
    if (!descResult.success) {
      return {
        ok: false,
        error: `Folder "${node.name}": ${descResult.error.issues[0]?.message ?? "invalid description"}`,
      };
    }

    if (node.description.trim().toLowerCase() === node.name.trim().toLowerCase()) {
      return {
        ok: false,
        error: `Folder "${node.name}": description must differ from the folder name`,
      };
    }
  }

  // Edge validation
  const incomingCount = new Map<string, number>();

  for (const edge of edges) {
    if (!refs.has(edge.sourceRef)) {
      return { ok: false, error: `Path references unknown source ref: "${edge.sourceRef}"` };
    }
    if (!refs.has(edge.targetRef)) {
      return { ok: false, error: `Path references unknown target ref: "${edge.targetRef}"` };
    }
    if (edge.targetRef === rootRef) {
      return { ok: false, error: "The root folder cannot be the target of a Path" };
    }
    const count = (incomingCount.get(edge.targetRef) ?? 0) + 1;
    if (count > 1) {
      return {
        ok: false,
        error: `Folder ref "${edge.targetRef}" has more than one parent. Taxonomy must be a tree.`,
      };
    }
    incomingCount.set(edge.targetRef, count);
  }

  // Cycle detection
  if (hasCycleInRefs(edges)) {
    return { ok: false, error: "Taxonomy contains a cycle" };
  }

  // Exactly one catch-all, which must be a non-root leaf. The catch-all is the
  // mandatory structural home for automated/bulk mail; it is excluded from
  // routing, so a missing one silently breaks bulk filing and a non-leaf one
  // would orphan its children from the router. The app guarantees one per
  // workspace, and import/generation must preserve that. Checked last so a file
  // with other structural problems reports those first.
  const catchAllNodes = nodes.filter((n) => n.isCatchAll);
  if (catchAllNodes.length === 0) {
    return { ok: false, error: "Taxonomy must have exactly one catch-all folder (e.g. Updates / Other)" };
  }
  if (catchAllNodes.length > 1) {
    return { ok: false, error: "Taxonomy must have exactly one catch-all folder. Found multiple." };
  }
  const catchAll = catchAllNodes[0]!;
  if (catchAll.isRoot) {
    return { ok: false, error: "The catch-all folder cannot also be the root (Inbox)" };
  }
  if (edges.some((e) => e.sourceRef === catchAll.ref)) {
    return { ok: false, error: `Catch-all folder "${catchAll.name}" must be a leaf (it cannot have sub-folders)` };
  }
  // The catch-all hangs directly off the inbox: its only parent may be the
  // root. Nesting it under another folder would let that folder's own
  // reachability decide whether the catch-all is orphaned, even though it
  // still receives all automated/bulk mail.
  if (edges.some((e) => e.targetRef === catchAll.ref && e.sourceRef !== rootRef)) {
    return { ok: false, error: `Catch-all folder "${catchAll.name}" can only be connected directly to the Inbox` };
  }

  return { ok: true, data: file };
}

// ─── Serializer ───────────────────────────────────────────────────────────────

export function serializeTaxonomy(
  nodes: TaxonomyNode[],
  edges: TaxonomyEdge[]
): TaxonomyTransferFile {
  return {
    aziruTaxonomyVersion: TAXONOMY_TRANSFER_VERSION,
    exportedAt: new Date().toISOString(),
    nodes: nodes.map((n) => ({
      ref: n.id,
      name: n.name,
      description: n.description,
      instructions: n.instructions,
      draftPrompt: n.draftPrompt,
      examples: n.examples,
      isRoot: n.isRoot,
      isCatchAll: n.isCatchAll ?? false,
      positionX: n.positionX,
      positionY: n.positionY,
    })),
    edges: edges.map((e) => ({
      sourceRef: e.sourceNodeId,
      targetRef: e.targetNodeId,
    })),
  };
}
