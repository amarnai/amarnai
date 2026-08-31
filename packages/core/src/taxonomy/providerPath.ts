// Builds the provider-side names for folder→label writeback: Gmail nests labels
// on "/", so a node's path becomes "Aziru/Parent/Child"; Outlook categories are
// flat and use the same joined string as a literal display name. The taxonomy is
// a node+edge DAG (no parentId), so a canonical-parent rule is needed to derive a
// single stable path per node.
//
// NOTE: intentionally separate from ai/embedding `deriveBreadcrumb`, whose output
// feeds the embedding text hash and whose parent map is insertion-order-dependent.
// Changing that would churn every embedding; this module owns writeback naming.

/** Root namespace segment every provider label/category lives under. */
export const PROVIDER_LABEL_NAMESPACE = "Aziru";

// Length caps: a single segment is bounded so no one folder name dominates, and
// the full joined name stays under the tighter of Gmail's (~225) / Outlook's
// (255) limits with margin. Conservative on purpose — these are display names.
const MAX_SEGMENT_LENGTH = 60;
const MAX_PATH_LENGTH = 200;

type PathNode = { id: string; name: string; isRoot: boolean };
type PathEdge = {
  sourceNodeId: string;
  targetNodeId: string;
  id: string;
  createdAt: Date;
};

/**
 * Sanitize one folder name into a provider-safe path segment. Strips the
 * characters that would corrupt the encoding — "/" and "\" (Gmail nesting) and
 * "," (Outlook comma-separates category display) become "-" — collapses
 * whitespace, and bounds the length. An empty result becomes "Untitled" so a
 * folder never yields a zero-length segment.
 */
export function sanitizeProviderSegment(name: string): string {
  const cleaned = name
    .replace(/[/\\,]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  const nonEmpty = cleaned.length > 0 ? cleaned : "Untitled";
  return nonEmpty.length > MAX_SEGMENT_LENGTH
    ? nonEmpty.slice(0, MAX_SEGMENT_LENGTH).trimEnd()
    : nonEmpty;
}

/**
 * Derive the canonical ancestor-to-node path (excluding the root node's own
 * name) for a single node, as sanitized segments. Walks child→parent choosing,
 * among a node's incoming edges, the one minimal by (createdAt, id) — the oldest
 * edge, id as a deterministic tiebreak — so the path is stable as edges are
 * added elsewhere in the graph. Cycle-guarded. Stops at (and excludes) an isRoot
 * ancestor. Returns [] for a root node (root = "no Aziru label").
 */
export function deriveCanonicalPathSegments(
  nodeId: string,
  nodes: ReadonlyArray<PathNode>,
  edges: ReadonlyArray<PathEdge>,
): string[] {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  // Canonical parent per node: the min incoming edge by (createdAt, id).
  const parentMap = new Map<string, string>();
  const bestEdge = new Map<string, PathEdge>();
  for (const edge of edges) {
    const prev = bestEdge.get(edge.targetNodeId);
    if (!prev || isEdgeSmaller(edge, prev)) {
      bestEdge.set(edge.targetNodeId, edge);
      parentMap.set(edge.targetNodeId, edge.sourceNodeId);
    }
  }

  const start = nodeMap.get(nodeId);
  if (!start || start.isRoot) return [];

  const names: string[] = [];
  const visited = new Set<string>();
  let current: string | undefined = nodeId;

  while (current) {
    if (visited.has(current)) break;
    visited.add(current);
    const node = nodeMap.get(current);
    if (!node) break;
    if (node.isRoot) break; // exclude the root name from the path
    names.push(sanitizeProviderSegment(node.name));
    current = parentMap.get(current);
  }

  return names.reverse();
}

function isEdgeSmaller(a: PathEdge, b: PathEdge): boolean {
  const at = a.createdAt.getTime();
  const bt = b.createdAt.getTime();
  if (at !== bt) return at < bt;
  return a.id < b.id;
}

/**
 * Build the full provider path (namespace-prefixed segment list) for every
 * node, keyed by node id. Root nodes are omitted from the result (they carry no
 * label). Enforces the total-length cap by truncating the leaf segment, and
 * resolves post-sanitization name collisions deterministically by suffixing the
 * later node (ordered by node id) with a short id fragment.
 */
export function buildProviderPaths(
  nodes: ReadonlyArray<PathNode>,
  edges: ReadonlyArray<PathEdge>,
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  const seenJoined = new Set<string>();

  // Deterministic order so collision suffixing is stable across runs.
  const ordered = [...nodes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  for (const node of ordered) {
    if (node.isRoot) continue;
    const ancestry = deriveCanonicalPathSegments(node.id, nodes, edges);
    let segments = [PROVIDER_LABEL_NAMESPACE, ...ancestry];
    segments = enforcePathLength(segments);
    segments = resolveCollision(segments, seenJoined, node.id);
    seenJoined.add(segments.join("/").toLowerCase());
    result.set(node.id, segments);
  }

  return result;
}

// Truncate the leaf so the joined path fits the cap. Ancestors are left intact
// (truncating them would break the shared prefix Gmail nests on).
function enforcePathLength(segments: string[]): string[] {
  const joined = segments.join("/");
  if (joined.length <= MAX_PATH_LENGTH || segments.length === 0) return segments;
  const prefix = segments.slice(0, -1).join("/");
  const room = MAX_PATH_LENGTH - prefix.length - 1; // 1 for the joining "/"
  const leaf = segments[segments.length - 1]!;
  const truncatedLeaf = room > 0 ? leaf.slice(0, room).trimEnd() || "Untitled" : "Untitled";
  return [...segments.slice(0, -1), truncatedLeaf];
}

// If the joined name (case-insensitively) already exists, append a short id
// fragment to the leaf so the two folders map to distinct labels/categories.
function resolveCollision(
  segments: string[],
  seenJoined: Set<string>,
  nodeId: string,
): string[] {
  const joined = segments.join("/").toLowerCase();
  if (!seenJoined.has(joined)) return segments;
  const leaf = segments[segments.length - 1]!;
  const suffixed = `${leaf} (${nodeId.slice(-4)})`;
  return [...segments.slice(0, -1), suffixed];
}
