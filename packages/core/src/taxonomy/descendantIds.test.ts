import { describe, it, expect } from "vitest";
import { descendantIds } from "./descendantIds.js";

type Edge = { sourceNodeId: string; targetNodeId: string };
function edge(source: string, target: string): Edge {
  return { sourceNodeId: source, targetNodeId: target };
}

describe("descendantIds", () => {
  it("returns all transitive children, excluding the node itself", () => {
    const edges = [
      edge("root", "a"),
      edge("a", "a1"),
      edge("a1", "a1x"),
      edge("root", "b"),
    ];
    expect([...descendantIds(edges, "a")].sort()).toEqual(["a1", "a1x"]);
    expect([...descendantIds(edges, "a1")].sort()).toEqual(["a1x"]);
    expect(descendantIds(edges, "b").size).toBe(0);
  });
});
