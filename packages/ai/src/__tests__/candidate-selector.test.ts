import { describe, it, expect } from "vitest";
import {
  selectCandidatePaths,
  tokenize,
  MAX_CANDIDATE_PATHS,
} from "../candidate-selector.js";
import type { EmailInput } from "../candidate-selector.js";
import type { TaxonomyNodeInput, TaxonomyEdgeInput } from "../types.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeNode(
  id: string,
  name: string,
  opts: Partial<TaxonomyNodeInput> = {}
): TaxonomyNodeInput {
  return {
    id,
    name,
    description: null,
    instructions: null,
    examples: [],
    isRoot: false,
    ...opts,
  };
}

function makeEdge(
  id: string,
  sourceNodeId: string,
  targetNodeId: string,
): TaxonomyEdgeInput {
  return { id, sourceNodeId, targetNodeId };
}

const ROOT = makeNode("root", "Inbox", { isRoot: true });
const CLIENTS = makeNode("clients", "Clients", { description: "Emails from external clients and stakeholders" });
const FINANCE = makeNode("finance", "Finance", { description: "Invoices billing payments receipts" });

const EDGE_ROOT_CLIENTS = makeEdge("e-rc", "root", "clients");
const EDGE_ROOT_FINANCE = makeEdge("e-rf", "root", "finance");

const BASE_NODES = [ROOT, CLIENTS, FINANCE];
const BASE_EDGES = [EDGE_ROOT_CLIENTS, EDGE_ROOT_FINANCE];

// ─── tokenize ─────────────────────────────────────────────────────────────────

describe("tokenize", () => {
  it("lowercases and strips punctuation", () => {
    expect(tokenize("Invoice, Payment!")).toEqual(["invoice", "payment"]);
  });

  it("removes stopwords", () => {
    expect(tokenize("Is this a client email?")).not.toContain("is");
    expect(tokenize("Is this a client email?")).not.toContain("this");
    expect(tokenize("Is this a client email?")).toContain("client");
    expect(tokenize("Is this a client email?")).toContain("email");
  });

  it("removes single-character tokens", () => {
    expect(tokenize("A B C")).toEqual([]);
  });
});

// ─── selectCandidatePaths ─────────────────────────────────────────────────────

describe("selectCandidatePaths — no root node", () => {
  it("returns empty candidates and warns when no root node exists", () => {
    const node = makeNode("n1", "Clients");
    const result = selectCandidatePaths([node], [], [{ bodyText: "hello" }]);
    expect(result.candidates).toHaveLength(0);
    expect(result.diagnostics.warnings.some((w) => /No root/.test(w))).toBe(true);
  });
});

describe("selectCandidatePaths — valid taxonomy", () => {
  it("returns all non-root destination nodes as candidates", () => {
    const result = selectCandidatePaths(BASE_NODES, BASE_EDGES, []);
    const nodeIds = result.candidates.map((c) => c.finalNodeId);
    expect(nodeIds).toContain("clients");
    expect(nodeIds).toContain("finance");
  });

  it("does not include the root node as a destination", () => {
    const result = selectCandidatePaths(BASE_NODES, BASE_EDGES, []);
    const nodeIds = result.candidates.map((c) => c.finalNodeId);
    expect(nodeIds).not.toContain("root");
  });

  it("scores higher when email matches node name (weight 3)", () => {
    const emails: EmailInput[] = [{ bodyText: "clients project update" }];
    const result = selectCandidatePaths(BASE_NODES, BASE_EDGES, emails);
    const clientsCandidate = result.candidates.find((c) => c.finalNodeId === "clients");
    const financeCandidate = result.candidates.find((c) => c.finalNodeId === "finance");
    expect(clientsCandidate).toBeDefined();
    expect(financeCandidate).toBeDefined();
    expect(clientsCandidate!.score).toBeGreaterThan(financeCandidate!.score);
    expect(result.candidates[0]!.finalNodeId).toBe("clients");
  });

  it("description match contributes to score (weight 2)", () => {
    const nodeA = makeNode("a", "Alpha", { description: null });
    const nodeB = makeNode("b", "Beta", { description: "invoice billing payments" });
    const nodes = [ROOT, nodeA, nodeB];
    const edges = [makeEdge("ea", "root", "a"), makeEdge("eb", "root", "b")];
    const emails: EmailInput[] = [{ bodyText: "invoice received" }];
    const result = selectCandidatePaths(nodes, edges, emails);
    const aCandidate = result.candidates.find((c) => c.finalNodeId === "a");
    const bCandidate = result.candidates.find((c) => c.finalNodeId === "b");
    expect(bCandidate!.score).toBeGreaterThan(aCandidate!.score);
    expect(result.diagnostics.matchedProfiles).toContain("description");
  });

  it("ancestor name match contributes to score (weight 1)", () => {
    // root → work (ancestor) → clients (final)
    const workNode = makeNode("work", "Work");
    const clientLeaf = makeNode("clientleaf", "Contacts", { description: null });
    const nodes = [ROOT, workNode, clientLeaf];
    const edges = [
      makeEdge("e1", "root", "work"),
      makeEdge("e2", "work", "clientleaf"),
    ];
    const emails: EmailInput[] = [{ bodyText: "work related email" }];
    const result = selectCandidatePaths(nodes, edges, emails);
    const candidate = result.candidates.find((c) => c.finalNodeId === "clientleaf");
    expect(candidate).toBeDefined();
    expect(candidate!.score).toBeGreaterThan(0);
    expect(result.diagnostics.matchedProfiles).toContain("ancestor");
  });

  it("sibling name match contributes with lower weight (0.5 vs 3 for name)", () => {
    const nodeA = makeNode("a", "Alpha");
    const nodeB = makeNode("b", "Finance");
    const nodes = [ROOT, nodeA, nodeB];
    const edges = [makeEdge("ea", "root", "a"), makeEdge("eb", "root", "b")];
    const emails: EmailInput[] = [{ bodyText: "finance department" }];
    const result = selectCandidatePaths(nodes, edges, emails);
    const aCandidate = result.candidates.find((c) => c.finalNodeId === "a");
    const bCandidate = result.candidates.find((c) => c.finalNodeId === "b");
    expect(bCandidate!.score).toBeGreaterThan(aCandidate!.score);
    expect(result.diagnostics.matchedProfiles).toContain("sibling");
  });

  it("warns when all candidate scores are zero (no token overlap)", () => {
    const emails: EmailInput[] = [{ bodyText: "zzzzzyyyy xxxxxwwww" }];
    const result = selectCandidatePaths(BASE_NODES, BASE_EDGES, emails);
    expect(result.diagnostics.warnings.some((w) => /zero/.test(w))).toBe(true);
  });

  it("handles cycles in edges without hanging", () => {
    const nodeA = makeNode("a", "Alpha");
    const nodeB = makeNode("b", "Beta");
    const nodes = [ROOT, nodeA, nodeB];
    const edges = [
      makeEdge("e1", "root", "a"),
      makeEdge("e2", "a", "b"),
      makeEdge("e3", "b", "a"), // cycle
    ];
    const result = selectCandidatePaths(nodes, edges, []);
    expect(result.candidates.length).toBeGreaterThanOrEqual(1);
  });

  it("caps results at MAX_CANDIDATE_PATHS", () => {
    const leafNodes: TaxonomyNodeInput[] = [];
    const leafEdges: TaxonomyEdgeInput[] = [];
    for (let i = 0; i < 20; i++) {
      const id = `leaf${i}`;
      leafNodes.push(makeNode(id, `Category ${i}`));
      leafEdges.push(makeEdge(`e${i}`, "root", id));
    }
    const result = selectCandidatePaths([ROOT, ...leafNodes], leafEdges, []);
    expect(result.candidates.length).toBeLessThanOrEqual(MAX_CANDIDATE_PATHS);
    expect(result.candidates.length).toBe(MAX_CANDIDATE_PATHS);
  });

  it("promotes a fallback-named node to the last slot when it would be cut off", () => {
    const highNodes: TaxonomyNodeInput[] = [];
    const highEdges: TaxonomyEdgeInput[] = [];
    for (let i = 0; i < MAX_CANDIDATE_PATHS; i++) {
      const id = `high${i}`;
      highNodes.push(makeNode(id, `Matching Category ${i}`));
      highEdges.push(makeEdge(`eh${i}`, "root", id));
    }
    const fallbackNode = makeNode("fallback", "Other");
    highEdges.push(makeEdge("ef", "root", "fallback"));

    const emails: EmailInput[] = [{ bodyText: "matching email content" }];
    const result = selectCandidatePaths(
      [ROOT, ...highNodes, fallbackNode],
      highEdges,
      emails
    );

    expect(result.candidates.length).toBe(MAX_CANDIDATE_PATHS);
    const lastCandidate = result.candidates[MAX_CANDIDATE_PATHS - 1]!;
    expect(lastCandidate.finalNodeId).toBe("fallback");
    expect(result.diagnostics.warnings.some((w) => /promoted/.test(w))).toBe(true);
  });
});
