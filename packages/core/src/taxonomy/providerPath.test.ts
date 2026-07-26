import { describe, it, expect } from "vitest";
import {
  sanitizeProviderSegment,
  deriveCanonicalPathSegments,
  buildProviderPaths,
} from "./providerPath.js";

const node = (id: string, name: string, isRoot = false) => ({ id, name, isRoot });
const edge = (id: string, sourceNodeId: string, targetNodeId: string, ms: number) => ({
  id,
  sourceNodeId,
  targetNodeId,
  createdAt: new Date(ms),
});

describe("sanitizeProviderSegment", () => {
  it("replaces path- and category-breaking characters with '-'", () => {
    expect(sanitizeProviderSegment("Clients/Acme")).toBe("Clients-Acme");
    expect(sanitizeProviderSegment("A, B")).toBe("A- B");
    expect(sanitizeProviderSegment("back\\slash")).toBe("back-slash");
  });

  it("collapses whitespace and trims", () => {
    expect(sanitizeProviderSegment("  hello   world  ")).toBe("hello world");
  });

  it("falls back to 'Untitled' for an empty result", () => {
    expect(sanitizeProviderSegment("   ")).toBe("Untitled");
    expect(sanitizeProviderSegment("///")).toBe("---");
  });

  it("truncates over-long segments", () => {
    const long = "x".repeat(100);
    expect(sanitizeProviderSegment(long).length).toBe(60);
  });
});

describe("deriveCanonicalPathSegments", () => {
  it("excludes the root name and returns child-to-node order", () => {
    const nodes = [node("r", "Root", true), node("a", "Clients"), node("b", "Acme")];
    const edges = [edge("e1", "r", "a", 1), edge("e2", "a", "b", 2)];
    expect(deriveCanonicalPathSegments("b", nodes, edges)).toEqual(["Clients", "Acme"]);
  });

  it("returns [] for a root node", () => {
    const nodes = [node("r", "Root", true)];
    expect(deriveCanonicalPathSegments("r", nodes, [])).toEqual([]);
  });

  it("picks the canonical parent deterministically (oldest edge, id tiebreak) for a diamond", () => {
    // b has two parents p1 (older) and p2 (newer); canonical must be p1.
    const nodes = [
      node("r", "Root", true),
      node("p1", "Alpha"),
      node("p2", "Beta"),
      node("b", "Leaf"),
    ];
    const edges = [
      edge("e1", "r", "p1", 1),
      edge("e2", "r", "p2", 1),
      edge("z-newer", "p2", "b", 5),
      edge("a-older", "p1", "b", 2),
    ];
    expect(deriveCanonicalPathSegments("b", nodes, edges)).toEqual(["Alpha", "Leaf"]);

    // Same result regardless of edge input order (determinism).
    const shuffled = [...edges].reverse();
    expect(deriveCanonicalPathSegments("b", nodes, shuffled)).toEqual(["Alpha", "Leaf"]);
  });

  it("uses id as the tiebreak when edge timestamps are equal", () => {
    const nodes = [node("r", "Root", true), node("p1", "Alpha"), node("p2", "Beta"), node("b", "Leaf")];
    const edges = [
      edge("e1", "r", "p1", 1),
      edge("e2", "r", "p2", 1),
      edge("zzz", "p2", "b", 3),
      edge("aaa", "p1", "b", 3), // same ms; "aaa" < "zzz" wins
    ];
    expect(deriveCanonicalPathSegments("b", nodes, edges)).toEqual(["Alpha", "Leaf"]);
  });

  it("guards against cycles", () => {
    const nodes = [node("a", "A"), node("b", "B")];
    const edges = [edge("e1", "a", "b", 1), edge("e2", "b", "a", 2)];
    // Should terminate, not infinite-loop.
    expect(() => deriveCanonicalPathSegments("b", nodes, edges)).not.toThrow();
  });
});

describe("buildProviderPaths", () => {
  it("prefixes the namespace and omits root nodes", () => {
    const nodes = [node("r", "Root", true), node("a", "Clients"), node("b", "Acme")];
    const edges = [edge("e1", "r", "a", 1), edge("e2", "a", "b", 2)];
    const paths = buildProviderPaths(nodes, edges);
    expect(paths.get("r")).toBeUndefined();
    expect(paths.get("a")).toEqual(["Amarnai", "Clients"]);
    expect(paths.get("b")).toEqual(["Amarnai", "Clients", "Acme"]);
  });

  it("disambiguates colliding sanitized names with an id suffix", () => {
    // Two sibling nodes whose sanitized names collide.
    const nodes = [
      node("r", "Root", true),
      node("aaaa1111", "Acme/Co"),
      node("bbbb2222", "Acme-Co"),
    ];
    const edges = [edge("e1", "r", "aaaa1111", 1), edge("e2", "r", "bbbb2222", 2)];
    const paths = buildProviderPaths(nodes, edges);
    const first = paths.get("aaaa1111")!.join("/");
    const second = paths.get("bbbb2222")!.join("/");
    expect(first).not.toBe(second);
    // The later node (by id order) gets suffixed.
    expect(second).toContain("(2222)");
  });

  it("gives catch-all nodes a normal path", () => {
    const nodes = [node("r", "Root", true), node("c", "Other")];
    const edges = [edge("e1", "r", "c", 1)];
    expect(buildProviderPaths(nodes, edges).get("c")).toEqual(["Amarnai", "Other"]);
  });
});
