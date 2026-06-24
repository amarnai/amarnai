import { z } from "zod";
import { nodeNameSchema, nodeDescriptionSchema } from "./taxonomy.js";
import type { TaxonomyNode, TaxonomyEdge } from "./taxonomy.js";

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
  amarnaiTaxonomyVersion: z.literal(TAXONOMY_TRANSFER_VERSION),
  exportedAt: z.string().datetime(),
  nodes: z.array(TaxonomyTransferNodeSchema).min(1).max(MAX_TAXONOMY_TRANSFER_NODES),
  edges: z.array(TaxonomyTransferEdgeSchema).max(MAX_TAXONOMY_TRANSFER_EDGES),
});
export type TaxonomyTransferFile = z.infer<typeof TaxonomyTransferFileSchema>;

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

  return { ok: true, data: file };
}

// ─── Serializer ───────────────────────────────────────────────────────────────

export function serializeTaxonomy(
  nodes: TaxonomyNode[],
  edges: TaxonomyEdge[]
): TaxonomyTransferFile {
  return {
    amarnaiTaxonomyVersion: TAXONOMY_TRANSFER_VERSION,
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
