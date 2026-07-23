import { describe, expect, it } from "vitest";
import { computeIgnoredReasons } from "./computeIgnoredReasons.js";
import type { TaxonomyNode, TaxonomyEdge } from "@amarnai/api-client";

function makeNode(overrides: Partial<TaxonomyNode> & { id: string }): TaxonomyNode {
  return {
    workspaceId: "ws_1",
    name: overrides.id,
    description: null,
    instructions: null,
    draftPrompt: null,
    examples: [],
    isRoot: false,
    isCatchAll: false,
    colorKey: null,
    positionX: 0,
    positionY: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    threadCount: 0,
    ...overrides,
  };
}

function makeEdge(id: string, sourceNodeId: string, targetNodeId: string): TaxonomyEdge {
  return {
    id,
    workspaceId: "ws_1",
    sourceNodeId,
    targetNodeId,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("computeIgnoredReasons", () => {
  const root = makeNode({ id: "root", isRoot: true });

  it("does not flag the root node", () => {
    const result = computeIgnoredReasons([root], []);
    expect(result.has("root")).toBe(false);
  });

  it("flags a non-root node with no incoming edges as no-incoming", () => {
    const leaf = makeNode({ id: "leaf" });
    const result = computeIgnoredReasons([root, leaf], []);
    expect(result.get("leaf")).toBe("no-incoming");
  });

  it("does not flag a node that has at least one incoming edge", () => {
    const leaf = makeNode({ id: "leaf" });
    const edge = makeEdge("e1", "root", "leaf");
    const result = computeIgnoredReasons([root, leaf], [edge]);
    expect(result.has("leaf")).toBe(false);
  });

  it("does not flag an internal node that has both incoming and outgoing edges", () => {
    const mid = makeNode({ id: "mid" });
    const leaf = makeNode({ id: "leaf" });
    const e1 = makeEdge("e1", "root", "mid");
    const e2 = makeEdge("e2", "mid", "leaf");
    const result = computeIgnoredReasons([root, mid, leaf], [e1, e2]);
    expect(result.has("mid")).toBe(false);
  });

  it("flags multiple disconnected nodes independently", () => {
    const a = makeNode({ id: "a" });
    const b = makeNode({ id: "b" });
    const c = makeNode({ id: "c" });
    const edge = makeEdge("e1", "root", "b");
    const result = computeIgnoredReasons([root, a, b, c], [edge]);
    expect(result.get("a")).toBe("no-incoming");
    expect(result.has("b")).toBe(false);
    expect(result.get("c")).toBe("no-incoming");
  });

  it("flags a node that has an incoming edge but is not reachable from the root", () => {
    // orphan -> leaf forms an island: leaf has an incoming edge, but neither
    // node is reachable from the root, so both must be ignored.
    const orphan = makeNode({ id: "orphan" });
    const leaf = makeNode({ id: "leaf" });
    const edge = makeEdge("e1", "orphan", "leaf");
    const result = computeIgnoredReasons([root, orphan, leaf], [edge]);
    expect(result.get("orphan")).toBe("no-incoming");
    expect(result.get("leaf")).toBe("no-incoming");
  });

  it("flags every node when there is no root", () => {
    const a = makeNode({ id: "a" });
    const b = makeNode({ id: "b" });
    const edge = makeEdge("e1", "a", "b");
    const result = computeIgnoredReasons([a, b], [edge]);
    expect(result.get("a")).toBe("no-incoming");
    expect(result.get("b")).toBe("no-incoming");
  });
});
