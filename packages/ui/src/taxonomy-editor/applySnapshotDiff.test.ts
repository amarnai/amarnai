import { describe, it, expect, vi } from "vitest";
import type { ApiClient, TaxonomyNode, TaxonomyEdge } from "@amarnai/api-client";
import type { GraphSnapshot } from "@amarnai/core/taxonomy";
import { applySnapshotDiff, nodesIdentical } from "./applySnapshotDiff.js";

function node(overrides: Partial<TaxonomyNode> & { id: string }): TaxonomyNode {
  return {
    name: "Folder",
    description: null,
    instructions: null,
    draftPrompt: null,
    examples: [],
    isRoot: false,
    isCatchAll: false,
    colorKey: null,
    positionX: 0,
    positionY: 0,
    threadCount: 0,
    ...overrides,
  } as TaxonomyNode;
}

function edge(id: string, sourceNodeId: string, targetNodeId: string): TaxonomyEdge {
  return { id, sourceNodeId, targetNodeId } as TaxonomyEdge;
}

function snapshot(nodes: TaxonomyNode[], edges: TaxonomyEdge[] = []): GraphSnapshot {
  return { nodes, edges } as GraphSnapshot;
}

/** An api whose createTaxonomyNode hands back a new server id, as the real one does. */
function makeApi() {
  let created = 0;
  const api = {
    createTaxonomyNode: vi.fn(async (_ws: string, input: Record<string, unknown>) => {
      created += 1;
      return node({ id: `server-${created}`, ...(input as object) });
    }),
    updateTaxonomyNode: vi.fn(async () => node({ id: "x" })),
    deleteTaxonomyNode: vi.fn(async () => ({ ok: true })),
    createTaxonomyEdge: vi.fn(async () => edge("e-new", "a", "b")),
    deleteTaxonomyEdge: vi.fn(async () => ({ ok: true })),
  };
  return api as unknown as ApiClient & typeof api;
}

const ROOT = node({ id: "root", isRoot: true, name: "Inbox" });

describe("nodesIdentical", () => {
  it("treats a colour change as a change", () => {
    const a = node({ id: "n1", colorKey: null });
    const b = node({ id: "n1", colorKey: "sage" });

    expect(nodesIdentical(a, b)).toBe(false);
  });

  it("treats identical nodes as unchanged", () => {
    expect(nodesIdentical(node({ id: "n1" }), node({ id: "n1" }))).toBe(true);
  });
});

describe("applySnapshotDiff — undoing a colour change", () => {
  it("writes the colour back instead of reporting a no-op", async () => {
    const api = makeApi();
    const from = snapshot([ROOT, node({ id: "n1", colorKey: "sage" })]);
    const to = snapshot([ROOT, node({ id: "n1", colorKey: null })]);

    await applySnapshotDiff(api, from, to, "ws-1");

    expect(api.updateTaxonomyNode).toHaveBeenCalledWith(
      "ws-1",
      "n1",
      expect.objectContaining({ colorKey: null })
    );
  });
});

describe("applySnapshotDiff — undoing a folder deletion", () => {
  it("reattaches the restored folder to its parent under its new id", async () => {
    const api = makeApi();
    // The user deleted "Work" (and its incoming edge); undo restores both.
    const from = snapshot([ROOT]);
    const to = snapshot(
      [ROOT, node({ id: "n1", name: "Work" })],
      [edge("e1", "root", "n1")]
    );

    await applySnapshotDiff(api, from, to, "ws-1");

    // The recreated node has a fresh server id, and the edge must point at THAT,
    // not at the dead id the snapshot still carries.
    expect(api.createTaxonomyNode).toHaveBeenCalledTimes(1);
    expect(api.createTaxonomyEdge).toHaveBeenCalledWith("ws-1", {
      sourceNodeId: "root",
      targetNodeId: "server-1",
    });
  });

  it("remaps both ends when a whole branch is restored", async () => {
    const api = makeApi();
    const from = snapshot([ROOT]);
    const to = snapshot(
      [ROOT, node({ id: "n1", name: "Work" }), node({ id: "n2", name: "Clients" })],
      [edge("e1", "root", "n1"), edge("e2", "n1", "n2")]
    );

    await applySnapshotDiff(api, from, to, "ws-1");

    expect(api.createTaxonomyEdge).toHaveBeenCalledWith("ws-1", {
      sourceNodeId: "root",
      targetNodeId: "server-1",
    });
    // The child edge's SOURCE is also a recreated node.
    expect(api.createTaxonomyEdge).toHaveBeenCalledWith("ws-1", {
      sourceNodeId: "server-1",
      targetNodeId: "server-2",
    });
  });

  it("restores the folder's colour along with the folder", async () => {
    const api = makeApi();
    const from = snapshot([ROOT]);
    const to = snapshot([ROOT, node({ id: "n1", colorKey: "clay" })]);

    await applySnapshotDiff(api, from, to, "ws-1");

    expect(api.createTaxonomyNode).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({ colorKey: "clay" })
    );
  });
});

describe("applySnapshotDiff — ordering and no-ops", () => {
  it("does nothing when the snapshots match", async () => {
    const api = makeApi();
    const snap = snapshot([ROOT, node({ id: "n1" })], [edge("e1", "root", "n1")]);

    await applySnapshotDiff(api, snap, snap, "ws-1");

    expect(api.createTaxonomyNode).not.toHaveBeenCalled();
    expect(api.updateTaxonomyNode).not.toHaveBeenCalled();
    expect(api.deleteTaxonomyNode).not.toHaveBeenCalled();
  });

  it("removes an edge before the node it points at", async () => {
    const api = makeApi();
    const order: string[] = [];
    vi.mocked(api.deleteTaxonomyEdge).mockImplementation(async () => {
      order.push("edge");
      return { ok: true } as never;
    });
    vi.mocked(api.deleteTaxonomyNode).mockImplementation(async () => {
      order.push("node");
      return { ok: true } as never;
    });

    const from = snapshot([ROOT, node({ id: "n1" })], [edge("e1", "root", "n1")]);
    const to = snapshot([ROOT]);

    await applySnapshotDiff(api, from, to, "ws-1");

    expect(order).toEqual(["edge", "node"]);
  });

  it("never deletes the root", async () => {
    const api = makeApi();

    await applySnapshotDiff(api, snapshot([ROOT]), snapshot([]), "ws-1");

    expect(api.deleteTaxonomyNode).not.toHaveBeenCalled();
  });
});
