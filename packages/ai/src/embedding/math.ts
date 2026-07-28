import { createHash } from "node:crypto";
import { isPredominantlyCJK } from "@amarnai/shared";
import type { TaxonomyEdgeInput } from "../types.js";
import type { EmbeddableNode } from "./types.js";

// ─── Similarity ────────────────────────────────────────────────────────────────

/** Cosine similarity in [-1, 1]. Returns 0 for zero or mismatched-length vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ─── Mean-centering (anisotropy correction) ─────────────────────────────────────

/**
 * Element-wise mean (centroid) of equal-length vectors. Returns [] for empty
 * input. Vectors whose length differs from the first are skipped. Pure and
 * deterministic.
 */
export function meanVector(vectors: ReadonlyArray<number[]>): number[] {
  if (vectors.length === 0) return [];
  const dim = vectors[0]!.length;
  const sum = new Array<number>(dim).fill(0);
  let n = 0;
  for (const v of vectors) {
    if (v.length !== dim) continue;
    for (let i = 0; i < dim; i++) sum[i]! += v[i]!;
    n++;
  }
  if (n === 0) return [];
  for (let i = 0; i < dim; i++) sum[i]! /= n;
  return sum;
}

/**
 * `a - b` element-wise. Returns `a` unchanged when `b` is empty or the lengths
 * differ, so centering degrades to a no-op rather than corrupting on a shape
 * mismatch. Pure and deterministic.
 */
export function subtractVector(a: number[], b: number[]): number[] {
  if (b.length === 0 || a.length !== b.length) return a;
  return a.map((x, i) => x - b[i]!);
}

// ─── Softmax ───────────────────────────────────────────────────────────────────

/**
 * Temperature-scaled softmax. Temperature < 1 sharpens the distribution;
 * temperature approaching 0 approaches argmax (one-hot).
 */
export function softmax(scores: number[], temperature: number): number[] {
  if (scores.length === 0) return [];
  const t = Math.max(temperature, 1e-8);
  const scaled = scores.map((s) => s / t);
  const maxVal = Math.max(...scaled);
  const exps = scaled.map((s) => Math.exp(s - maxVal)); // numerically stable
  const sum = exps.reduce((acc, v) => acc + v, 0);
  return exps.map((v) => v / sum);
}

// ─── Embedding text builders ───────────────────────────────────────────────────

/**
 * Deterministic input text for a non-root taxonomy node's embedding.
 *
 * Format (exact — whitespace is part of the hash input):
 *   Path: Inbox > Parent > Node
 *   Name: Node
 *   Description: Node description
 *
 * The breadcrumb is derived from the current taxonomy tree via `deriveBreadcrumb`
 * and is never stored as a node field in the database.
 */
export function buildNodeEmbeddingText(node: {
  name: string;
  description: string;
  breadcrumb: string;
}): string {
  return `Path: ${node.breadcrumb}\nName: ${node.name}\nDescription: ${node.description}`;
}

/**
 * Derives the breadcrumb string for a node by walking up the taxonomy tree.
 * Returns e.g. "Inbox > Parent > Node" for a node reachable from root.
 * Returns just the node name if the node has no parent in the edge list.
 * Guards against cycles with a visited set.
 *
 * This function is only called during embedding refresh — not on every sort.
 */
export function deriveBreadcrumb(
  nodeId: string,
  nodes: ReadonlyArray<{ id: string; name: string; isRoot: boolean }>,
  edges: ReadonlyArray<TaxonomyEdgeInput>
): string {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const parentMap = new Map<string, string>();
  for (const edge of edges) {
    parentMap.set(edge.targetNodeId, edge.sourceNodeId);
  }

  const names: string[] = [];
  const visited = new Set<string>();
  let current = nodeId;

  while (true) {
    if (visited.has(current)) break;
    visited.add(current);
    const node = nodeMap.get(current);
    if (!node) break;
    names.push(node.name);
    if (node.isRoot) break;
    const parent = parentMap.get(current);
    if (!parent) break;
    current = parent;
  }

  return names.reverse().join(" > ");
}

/**
 * Returns the IDs of all descendant nodes of `nodeId` (not including `nodeId`).
 * Uses BFS over outgoing edges.
 */
export function findDescendants(
  nodeId: string,
  edges: ReadonlyArray<TaxonomyEdgeInput>
): string[] {
  const childrenMap = new Map<string, string[]>();
  for (const edge of edges) {
    const list = childrenMap.get(edge.sourceNodeId) ?? [];
    list.push(edge.targetNodeId);
    childrenMap.set(edge.sourceNodeId, list);
  }

  const result: string[] = [];
  const visited = new Set<string>([nodeId]);
  const queue: string[] = [nodeId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const child of childrenMap.get(current) ?? []) {
      if (visited.has(child)) continue;
      visited.add(child);
      result.push(child);
      queue.push(child);
    }
  }

  return result;
}

/**
 * Character budget for thread embedding text across all messages.
 *
 * The binding constraint is Gemini gemini-embedding-001 (production), which
 * accepts a maximum of 2,048 tokens. 6,000 chars ≈ 1,500 tokens leaves
 * ~500 tokens of headroom for the structural labels and subject line.
 *
 * qwen3-embedding (local dev) supports 32,768 tokens — the budget is kept
 * consistent with production rather than expanded to use that extra capacity.
 *
 * Distribution:
 *   - Latest message:  60 % of budget (3,600 chars)
 *   - Earlier messages: 40 % shared equally (2,400 chars total)
 *
 * If dividing the earlier budget equally would give each message fewer than
 * MIN_EARLIER_MSG_CHARS chars, oldest messages are dropped until each
 * remaining one receives at least that many.
 */
export const THREAD_EMBEDDING_CHAR_BUDGET = 6000;

const LATEST_SHARE = 0.6;
/** Minimum per-message budget for earlier messages before the oldest are dropped. */
const MIN_EARLIER_MSG_CHARS = 200;

// ─── Reply-tail detection (language-neutral) ─────────────────────────────────
//
// The redundant quoted reply chain ("thread summary") is identified by its
// STRUCTURE, not by English phrases like "On … wrote:", so it works for French
// ("Le … a écrit :"), German ("Am … schrieb …:"), Japanese ("…が…に書きました:"),
// and any other locale. Inline quotations — a ">" block followed by the author's
// own new text — are deliberately preserved; only a quoted/attributed block that
// runs to the end of the message is removed.

const QUOTED_LINE_RE = /^\s*>/;
const BLANK_LINE_RE = /^\s*$/;
/** An email-ish token: john@example.com or <john@example.com>. */
const CONTACT_RE = /\S+@\S+/;
/** A 4-digit year or an HH:MM time — the timestamp every attribution carries. */
const DATE_RE = /(?:19|20)\d\d|\d{1,2}:\d{2}/;
/** A line ending in a colon (the universal attribution terminator). */
const ENDS_COLON_RE = /:\s*$/;

/** Header-material line: ends in ":", or carries an email or a date. */
function looksAttributionish(line: string): boolean {
  return ENDS_COLON_RE.test(line) || CONTACT_RE.test(line) || DATE_RE.test(line);
}

/**
 * Index at which the redundant trailing reply chain begins, or -1 if none.
 *
 * Two structural, language-neutral signals:
 *
 *  (A) A trailing block of quoted (">") lines at end-of-message, optionally
 *      introduced by a wrapped attribution header. The quoted block is strong
 *      evidence of a reply tail, so a header directly above it is absorbed when
 *      it carries an email or date (a real "On … wrote:" line in any language)
 *      but never when it is plain prose (e.g. "Here are the options:").
 *
 *  (B) An unquoted reply tail: an attribution line that ends with ":", carries
 *      an email, and (with any wrapped continuation above it) carries a date,
 *      running to end-of-message. The email + date + colon combination is
 *      required so a mid-body colon line such as
 *      "I forwarded this to support@acme.com:" is never mistaken for a header.
 *
 * Pure: depends only on `lines`.
 */
function findReplyTailStart(lines: string[]): number {
  // (A) trailing quoted block, with any wrapped attribution header above it.
  let i = lines.length - 1;
  let sawQuoted = false;
  while (i >= 0 && (BLANK_LINE_RE.test(lines[i]!) || QUOTED_LINE_RE.test(lines[i]!))) {
    if (QUOTED_LINE_RE.test(lines[i]!)) sawQuoted = true;
    i--;
  }
  if (sawQuoted) {
    let cut = i + 1; // start of the trailing quoted/blank run
    // Absorb a header directly above the block: contiguous non-blank,
    // attribution-ish lines that together carry an email or date.
    let a = i;
    const header: string[] = [];
    while (a >= 0 && !BLANK_LINE_RE.test(lines[a]!) && looksAttributionish(lines[a]!)) {
      header.push(lines[a]!);
      a--;
    }
    if (header.some((l) => CONTACT_RE.test(l) || DATE_RE.test(l))) {
      cut = a + 1;
    }
    return cut;
  }

  // (B) unquoted reply tail introduced by an attribution header.
  for (let j = 0; j < lines.length; j++) {
    const line = lines[j]!;
    if (!ENDS_COLON_RE.test(line) || !CONTACT_RE.test(line)) continue;
    // Absorb a wrapped continuation above the colon line (the date/name line
    // that precedes e.g. "<john@example.com> wrote:").
    let a = j - 1;
    const header: string[] = [line];
    while (a >= 0 && !BLANK_LINE_RE.test(lines[a]!) && looksAttributionish(lines[a]!)) {
      header.push(lines[a]!);
      a--;
    }
    if (header.some((l) => DATE_RE.test(l))) return a + 1;
  }

  return -1;
}

/**
 * Strip email boilerplate from a message body before embedding.
 *
 * Operations (applied in order):
 *  1. Remove the redundant trailing reply chain (quoted "thread summary" and its
 *     attribution header) via language-neutral structure — see
 *     `findReplyTailStart`. Intentional inline quotes are preserved.
 *  2. Remove email signatures — everything after a bare "-- " line (RFC 3676)
 *     or after a recognisable sign-off phrase (Best regards, Thanks, …) when
 *     ≤ 4 lines follow it (name / title / company). The sign-off phrase list is
 *     English-only and best-effort; the RFC delimiter is language-neutral.
 *  3. Remove tracking/footer URLs — lines that consist of nothing but a URL.
 *  4. Normalise whitespace — collapse 3+ consecutive blank lines to one,
 *     trim leading/trailing whitespace.
 *
 * Pure and deterministic — identical inputs always produce identical outputs,
 * so embeddingTextHash invalidation is predictable. No locale-sensitive APIs
 * (no String.toLowerCase): case-insensitive matching uses the regex `i` flag,
 * whose Unicode case folding is locale-independent (no Turkish-i hazard).
 */
export function cleanForEmbedding(
  body: string,
  options?: { stripReplyTail?: boolean }
): string {
  // 1. Remove the redundant trailing reply chain (language-neutral, structural).
  //    Skipped when stripReplyTail is false: the caller knows this message has no
  //    earlier message in the thread (the first message, e.g. a forward), so its
  //    quoted block is novel content rather than a redundant copy of an earlier
  //    message and must be kept. See buildThreadEmbeddingText.
  const stripReplyTail = options?.stripReplyTail ?? true;
  if (stripReplyTail) {
    const lines = body.split("\n");
    const cut = findReplyTailStart(lines);
    if (cut >= 0) body = lines.slice(0, cut).join("\n");
  }

  // 2a. RFC 3676 signature delimiter: "-- " (or "--") on its own line.
  body = body.replace(/\n--\s*\n[\s\S]*$/, "");

  // 2b. Recognisable sign-off phrases near the end (≤ 4 remaining lines).
  //     Only strip when the remaining content is plausibly just a name block.
  //     A trailing period is NOT matched — "Thanks." is sentence punctuation,
  //     not a sign-off marker. Only "Thanks," or bare "Thanks" are stripped.
  const SIGNOFF_RE =
    /^(best\s+regards|kind\s+regards|warm\s+regards|yours\s+sincerely|yours|sincerely|regards|with\s+regards|best|thanks|thank\s+you|cheers),?\s*$/i;
  const signoffLines = body.split("\n");
  const signoffIdx = signoffLines.findIndex((l) => SIGNOFF_RE.test(l.trim()));
  if (signoffIdx !== -1 && signoffLines.length - signoffIdx <= 5) {
    body = signoffLines.slice(0, signoffIdx).join("\n");
  }

  // 3. Lines that are nothing but a URL (tracking pixels, unsubscribe links, …).
  body = body
    .split("\n")
    .filter((l) => !/^\s*https?:\/\/\S+\s*$/.test(l))
    .join("\n");

  // 4. Whitespace normalisation.
  return body.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * CJK scripts pack far more meaning — and far more embedding tokens — per
 * character than space-delimited Latin text, so the same character budget maps
 * to many more tokens. Scale the per-message character budget down for
 * predominantly-CJK bodies so a dense thread stays within the embedding model's
 * token limit (Gemini gemini-embedding-001: 2,048 tokens) instead of being
 * silently over-truncated at the provider. Non-CJK text is unaffected.
 */
const CJK_BUDGET_SCALE = 0.4;

/**
 * Truncate `text` to at most `budget` characters using a 70 / 30 head/tail split.
 *
 * The budget is scaled down for predominantly-CJK text (see CJK_BUDGET_SCALE)
 * so dense scripts respect the model's token limit. When the text fits within
 * the effective budget it is returned unchanged. When truncating, 70 % of the
 * budget comes from the head (topic, context) and 30 % from the tail (action
 * items, sign-off intent), separated by " … ".
 *
 * Pure and deterministic — isPredominantlyCJK is a pure script-ratio check.
 */
export function truncateToShare(text: string, budget: number): string {
  const effectiveBudget = isPredominantlyCJK(text)
    ? Math.floor(budget * CJK_BUDGET_SCALE)
    : budget;
  if (text.length <= effectiveBudget) return text;
  const headLen = Math.floor(effectiveBudget * 0.7);
  const tailLen = effectiveBudget - headLen;
  return `${text.slice(0, headLen)} … ${text.slice(-tailLen)}`;
}

/**
 * {@link cleanForEmbedding}, but never destructive: when cleaning would remove
 * everything, the original body is kept.
 *
 * A message whose entire content is a sign-off ("Thanks") cleans to the empty
 * string, which is harmless for an embedding but not for a prompt: the body
 * renders as "(no body)" and the model then summarises or answers a message it
 * cannot see. Embeddings deliberately keep the strict version, so their stored
 * input hashes stay stable.
 */
export function cleanBodyForPrompt(
  body: string,
  options?: { stripReplyTail?: boolean }
): string {
  return cleanForEmbedding(body, options) || body.trim();
}

/**
 * Split a character budget across a thread's messages.
 *
 * The latest message takes `latestShare` of the budget (it carries current
 * intent); the earlier ones share the remainder equally, and the oldest are
 * dropped when an equal share would fall below MIN_EARLIER_MSG_CHARS — a
 * 40-character slice of a message is noise, not context.
 *
 * `latestShare` is what separates the callers: embeddings and summaries are
 * breadth-weighted (0.6, the default) because they describe the whole thread,
 * while a draft must reproduce the message it is answering and so weights the
 * latest message far more heavily. The drop-oldest rule is the same either way.
 *
 * `messages` must be in chronological order (oldest first); the result is too.
 * Shared by the embedding text builder, the summary prompt, and the draft prompt
 * so the three cannot drift into different ideas of what a thread's context
 * window looks like.
 */
export function allocateThreadCharBudget<T>(
  messages: readonly T[],
  totalBudget: number,
  options?: { latestShare?: number }
): Array<{ message: T; budget: number; isLatest: boolean }> {
  if (messages.length === 0) return [];

  const latestBudget = Math.floor(totalBudget * (options?.latestShare ?? LATEST_SHARE));
  const latest = messages[messages.length - 1]!;
  if (messages.length === 1) return [{ message: latest, budget: latestBudget, isLatest: true }];

  const earlierBudget = totalBudget - latestBudget;
  let keptEarlier = messages.slice(0, -1);
  let perEarlier = Math.floor(earlierBudget / keptEarlier.length);
  while (perEarlier < MIN_EARLIER_MSG_CHARS && keptEarlier.length > 1) {
    keptEarlier = keptEarlier.slice(1); // drop oldest
    perEarlier = Math.floor(earlierBudget / keptEarlier.length);
  }

  return [
    ...keptEarlier.map((message) => ({ message, budget: perEarlier, isLatest: false })),
    { message: latest, budget: latestBudget, isLatest: true },
  ];
}

/**
 * Compact thread text for embedding (subject + cleaned, budgeted body excerpts).
 *
 * Current-intent policy: the latest message is the primary classification
 * signal. For multi-message threads the latest message is placed first and
 * labelled, with earlier messages listed afterwards as secondary context.
 * Single-message threads use the same budget logic with the flat format for
 * backward compatibility.
 *
 * Budget: THREAD_EMBEDDING_CHAR_BUDGET (6,000 chars ≈ 1,500 tokens).
 *   Set by Gemini gemini-embedding-001's 2,048-token production limit.
 *   Latest message:  60 % (3,600 chars).
 *   Earlier messages: 40 % shared equally across included messages (2,400 chars).
 *   If equal sharing would give each earlier message < MIN_EARLIER_MSG_CHARS,
 *   oldest messages are dropped until each kept message has enough room.
 *
 * Each included body is first passed through cleanForEmbedding to remove
 * quoted replies, signatures, and tracking URLs, then truncated with a
 * 70/30 head/tail split if it still exceeds its budget share.
 */
export function buildThreadEmbeddingText(
  messages: ReadonlyArray<{ subject?: string | null; bodyText?: string | null; attachmentNames?: string[] }>
): string {
  if (messages.length === 0) return "";

  const allocated = allocateThreadCharBudget(messages, THREAD_EMBEDDING_CHAR_BUDGET);
  const latestBudget = allocated[allocated.length - 1]!.budget;

  const parts: string[] = [];
  const firstSubject = messages[0]?.subject;
  if (firstSubject) parts.push(`Subject: ${firstSubject}`);

  // Positional reply-tail rule: a message's quoted tail is stripped only when an
  // earlier message exists in the thread (the tail duplicates it). The FIRST
  // message is never stripped — its quoted block is novel content, not a
  // duplicate, which is exactly the forwarded-email case (a forward often is only
  // its forwarded block). Keyed by reference; if the first message is later
  // dropped by the budget, nothing is treated as first and all kept messages
  // strip — acceptable, since its content is budget-dropped regardless.
  const firstMsg = messages[0];

  if (messages.length === 1) {
    // Single message: flat format (backward-compatible with stored hashes).
    // It is the first message, so its tail is kept (forward-safe).
    const msg = messages[0]!;
    if (msg.bodyText) {
      parts.push(truncateToShare(cleanForEmbedding(msg.bodyText, { stripReplyTail: false }), latestBudget));
    }
    if (msg.attachmentNames?.length) {
      parts.push(`Attachments: ${msg.attachmentNames.join(", ")}`);
    }
  } else {
    // Multi-message thread: latest first, earlier as secondary context.
    const latest = messages[messages.length - 1]!;

    parts.push("[LATEST MESSAGE — primary classification signal]");
    if (latest.bodyText) {
      parts.push(
        truncateToShare(cleanForEmbedding(latest.bodyText, { stripReplyTail: latest !== firstMsg }), latestBudget)
      );
    }
    if (latest.attachmentNames?.length) {
      parts.push(`Attachments: ${latest.attachmentNames.join(", ")}`);
    }

    // Earlier messages, oldest first, each with its allocated share. The oldest
    // are dropped by the allocator when their share would be too small to inform.
    const keptEarlier = allocated.filter((a) => !a.isLatest);

    if (keptEarlier.length > 0) {
      parts.push("[EARLIER THREAD CONTEXT — secondary]");
      for (const { message: msg, budget } of keptEarlier) {
        if (msg.bodyText) {
          parts.push(
            truncateToShare(cleanForEmbedding(msg.bodyText, { stripReplyTail: msg !== firstMsg }), budget)
          );
        }
        if (msg.attachmentNames?.length) {
          parts.push(`Attachments: ${msg.attachmentNames.join(", ")}`);
        }
      }
    }
  }

  return parts.join("\n\n");
}

// ─── Staleness hash ────────────────────────────────────────────────────────────

/** SHA-256 of `model::text`. Use to detect whether a stored embedding is stale. */
export function hashEmbeddingInput(text: string, model: string): string {
  return createHash("sha256").update(`${model}::${text}`).digest("hex");
}

// ─── Stale embedding detection ────────────────────────────────────────────────

/**
 * Returns the subset of `nodes` whose stored embedding is missing or stale
 * relative to the current embedding text (breadcrumb + name + description)
 * and the given `modelName`.
 *
 * Skips root nodes and nodes without descriptions — they are never embedded.
 * Use this to find which nodes need refreshing before sorting or in a backfill.
 */
export function getStaleEmbeddableNodes(
  nodes: ReadonlyArray<EmbeddableNode>,
  edges: ReadonlyArray<TaxonomyEdgeInput>,
  modelName: string
): EmbeddableNode[] {
  const result: EmbeddableNode[] = [];
  for (const n of nodes) {
    if (n.isRoot || n.description == null) continue;
    const breadcrumb = deriveBreadcrumb(n.id, nodes, edges);
    const text = buildNodeEmbeddingText({ name: n.name, description: n.description, breadcrumb });
    const expectedHash = hashEmbeddingInput(text, modelName);
    const isFresh =
      n.embeddingVector != null &&
      n.embeddingVector.length > 0 &&
      n.embeddingModel === modelName &&
      n.embeddingTextHash === expectedHash;
    if (!isFresh) result.push(n);
  }
  return result;
}

// ─── Subtree scoring ───────────────────────────────────────────────────────────

/**
 * Compute bottom-up subtree scores from `rootId` downward.
 *
 * - Leaf:   S(node) = rawSim(node)
 * - Parent: S(node) = max(rawSim(node), lambdaDecay * max(S(child)))
 *
 * Large subtrees do not dominate because we use max, not sum.
 * `rawSims` typically has no entry for Inbox; it defaults to 0.
 */
export function computeSubtreeScores(
  rootId: string,
  rawSims: ReadonlyMap<string, number>,
  edges: ReadonlyArray<TaxonomyEdgeInput>,
  lambdaDecay: number
): Map<string, number> {
  const childrenMap = new Map<string, string[]>();
  for (const edge of edges) {
    const list = childrenMap.get(edge.sourceNodeId) ?? [];
    list.push(edge.targetNodeId);
    childrenMap.set(edge.sourceNodeId, list);
  }

  const scores = new Map<string, number>();
  const visited = new Set<string>();

  function dfs(nodeId: string): number {
    if (visited.has(nodeId)) return scores.get(nodeId) ?? 0;
    visited.add(nodeId);

    const rawSim = rawSims.get(nodeId) ?? 0;
    const children = childrenMap.get(nodeId) ?? [];

    if (children.length === 0) {
      scores.set(nodeId, rawSim);
      return rawSim;
    }

    // Identity element for a max-fold is -Infinity, not 0. Seeding at 0 would
    // floor a negative max-child up to 0, which under mean-centering (where ~half
    // of centered similarities are negative) inflates the subtree score of any
    // branch whose entire subtree is below the thread mean. children.length > 0
    // here, so at least one real child score always replaces the seed.
    let maxChild = -Infinity;
    for (const childId of children) {
      const s = dfs(childId);
      if (s > maxChild) maxChild = s;
    }

    const score = Math.max(rawSim, lambdaDecay * maxChild);
    scores.set(nodeId, score);
    return score;
  }

  dfs(rootId);
  return scores;
}
