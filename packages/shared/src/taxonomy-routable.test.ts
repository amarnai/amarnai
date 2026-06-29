import { describe, it, expect } from "vitest";
import {
  countRoutableNonRootNodes,
  isTaxonomyRoutable,
  TAXONOMY_MIN_NON_ROOT_NODES,
} from "./taxonomy-routable.js";

type N = { id: string; isRoot: boolean; isCatchAll: boolean };
type E = { sourceNodeId: string; targetNodeId: string };

const root: N = { id: "root", isRoot: true, isCatchAll: false };

function node(id: string): N {
  return { id, isRoot: false, isCatchAll: false };
}

function edge(source: string, target: string): E {
  return { sourceNodeId: source, targetNodeId: target };
}

describe("countRoutableNonRootNodes", () => {
  it("returns 0 when there is no root node", () => {
    expect(countRoutableNonRootNodes([node("a"), node("b")], [])).toBe(0);
  });

  it("returns 0 when non-root nodes exist but none are linked to the root", () => {
    const nodes = [root, node("a"), node("b"), node("c")];
    expect(countRoutableNonRootNodes(nodes, [])).toBe(0);
  });

  it("counts only nodes reachable from the root", () => {
    // a, b connected to root; c is orphaned.
    const nodes = [root, node("a"), node("b"), node("c")];
    const edges = [edge("root", "a"), edge("root", "b")];
    expect(countRoutableNonRootNodes(nodes, edges)).toBe(2);
  });

  it("excludes catch-all nodes from the routable count", () => {
    // root -> a, b (real folders) and root -> other (catch-all).
    const other = { id: "other", isRoot: false, isCatchAll: true };
    const nodes = [root, node("a"), node("b"), other];
    const edges = [edge("root", "a"), edge("root", "b"), edge("root", "other")];
    // 2 real folders, not 3 — the catch-all does not count toward routability.
    expect(countRoutableNonRootNodes(nodes, edges)).toBe(2);
    expect(isTaxonomyRoutable(nodes, edges)).toBe(false);
  });

  it("counts transitively reachable descendants, not just direct children", () => {
    // root -> a -> b -> c is one chain; all three are reachable.
    const nodes = [root, node("a"), node("b"), node("c")];
    const edges = [edge("root", "a"), edge("a", "b"), edge("b", "c")];
    expect(countRoutableNonRootNodes(nodes, edges)).toBe(3);
  });

  it("ignores a disconnected subgraph even if its nodes link to each other", () => {
    // root -> a (reachable). b -> c form their own island (b has no path from root).
    const nodes = [root, node("a"), node("b"), node("c")];
    const edges = [edge("root", "a"), edge("b", "c")];
    expect(countRoutableNonRootNodes(nodes, edges)).toBe(1);
  });

  it("is resilient to cycles among reachable nodes", () => {
    const nodes = [root, node("a"), node("b")];
    const edges = [edge("root", "a"), edge("a", "b"), edge("b", "a")];
    expect(countRoutableNonRootNodes(nodes, edges)).toBe(2);
  });

  it("does not count edge targets that are not present in nodes", () => {
    const nodes = [root, node("a")];
    const edges = [edge("root", "a"), edge("a", "ghost")];
    expect(countRoutableNonRootNodes(nodes, edges)).toBe(1);
  });
});

describe("isTaxonomyRoutable", () => {
  it("is false when fewer than the threshold of nodes are reachable", () => {
    // 4 non-root nodes total, but only 2 reachable from root.
    const nodes = [root, node("a"), node("b"), node("c"), node("d")];
    const edges = [edge("root", "a"), edge("root", "b")];
    expect(countRoutableNonRootNodes(nodes, edges)).toBe(2);
    expect(isTaxonomyRoutable(nodes, edges)).toBe(false);
  });

  it("is true when the threshold of reachable nodes is met", () => {
    const nodes = [root, node("a"), node("b"), node("c")];
    const edges = [edge("root", "a"), edge("root", "b"), edge("root", "c")];
    expect(countRoutableNonRootNodes(nodes, edges)).toBe(TAXONOMY_MIN_NON_ROOT_NODES);
    expect(isTaxonomyRoutable(nodes, edges)).toBe(true);
  });

  it("is false when the threshold is met by node count but not by connectivity", () => {
    // 3 non-root nodes, but only 2 are linked to root; the third is orphaned.
    const nodes = [root, node("a"), node("b"), node("orphan")];
    const edges = [edge("root", "a"), edge("a", "b")];
    expect(isTaxonomyRoutable(nodes, edges)).toBe(false);
  });
});
