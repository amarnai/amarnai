import { describe, it, expect } from "vitest";
import type { TaxonomyTransferFile } from "@aziru/shared";
import { transferToDisplayGraph } from "./transferToDisplayGraph.js";

function node(ref: string, isRoot = false) {
  return {
    ref,
    name: isRoot ? "Inbox" : ref,
    description: isRoot ? null : `${ref} description long enough for this test.`,
    instructions: null,
    draftPrompt: null,
    examples: [] as string[],
    isRoot,
    positionX: isRoot ? 0 : 300,
    positionY: isRoot ? 0 : 140,
  };
}

const file: TaxonomyTransferFile = {
  aziruTaxonomyVersion: 1,
  exportedAt: "2026-06-24T00:00:00.000Z",
  nodes: [node("root", true), node("a"), node("b")],
  edges: [
    { sourceRef: "root", targetRef: "a" },
    { sourceRef: "root", targetRef: "b" },
  ],
};

describe("transferToDisplayGraph", () => {
  const { nodes, edges } = transferToDisplayGraph(file);

  it("maps refs to node ids", () => {
    expect(nodes.map((n) => n.id)).toEqual(["root", "a", "b"]);
  });

  it("maps edge refs to sourceNodeId / targetNodeId", () => {
    expect(edges[0]).toMatchObject({ sourceNodeId: "root", targetNodeId: "a" });
    expect(edges[1]).toMatchObject({ sourceNodeId: "root", targetNodeId: "b" });
  });

  it("produces stable, unique edge ids", () => {
    expect(edges[0]!.id).toBe("root->a");
    expect(edges[1]!.id).toBe("root->b");
    expect(new Set(edges.map((e) => e.id)).size).toBe(edges.length);
  });

  it("preserves positions from the transfer file", () => {
    const a = nodes.find((n) => n.id === "a")!;
    expect(a.positionX).toBe(300);
    expect(a.positionY).toBe(140);
  });

  it("preserves node fields", () => {
    const a = nodes.find((n) => n.id === "a")!;
    expect(a.name).toBe("a");
    expect(a.isRoot).toBe(false);
    expect(a.examples).toEqual([]);
    expect(a.description).toMatch(/description/);
  });

  it("stubs workspaceId and timestamps without throwing", () => {
    for (const n of nodes) {
      expect(n.workspaceId).toBe("");
      expect(n.createdAt).toBe("1970-01-01T00:00:00.000Z");
      expect(n.updatedAt).toBe("1970-01-01T00:00:00.000Z");
    }
    for (const e of edges) {
      expect(e.workspaceId).toBe("");
    }
  });
});
