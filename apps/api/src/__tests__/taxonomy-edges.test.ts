import { vi, describe, it, expect, beforeEach } from "vitest";
import { authed } from "./helpers.js";

vi.mock("@amarnai/db", () => ({
  db: {
    workspace: {
      findUnique: vi.fn(),
    },
    workspaceMember: {
      findUnique: vi.fn(),
    },
    taxonomyNode: {
      findUnique: vi.fn(),
    },
    taxonomyEdge: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import app from "../app.js";
import { db } from "@amarnai/db";

const WS_ID = "ws-1";
const EDGE_ID = "edge-1";
const NODE_A = "node-a";
const NODE_B = "node-b";
const NODE_C = "node-c";

const baseEdge = {
  id: EDGE_ID,
  workspaceId: WS_ID,
  sourceNodeId: NODE_A,
  targetNodeId: NODE_B,
  // Relation loaded by the DELETE/PATCH handlers to enforce catch-all rules.
  // baseEdge targets NODE_B, a normal folder, so isCatchAll is false.
  targetNode: { isCatchAll: false },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const nodeA = { id: NODE_A, workspaceId: WS_ID, isRoot: false };
const nodeB = { id: NODE_B, workspaceId: WS_ID, isRoot: false };
const nodeC = { id: NODE_C, workspaceId: WS_ID, isRoot: false };
const rootNode = { id: "root-1", workspaceId: WS_ID, isRoot: true };
const catchAllNode = { id: "catch-all-1", workspaceId: WS_ID, isRoot: false, isCatchAll: true };

function post(path: string, body: unknown) {
  return app.request(path, authed({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

function patch(path: string, body: unknown) {
  return app.request(path, authed({
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

function del(path: string) {
  return app.request(path, authed({ method: "DELETE" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.workspaceMember.findUnique).mockResolvedValue({ userId: "test-user-1" } as never);
});

// ─── GET ─────────────────────────────────────────────────────────────────────

describe("GET /workspaces/:workspaceId/taxonomy-edges", () => {
  it("returns edges for a workspace", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({
      taxonomyEdges: [baseEdge],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const res = await app.request(`/workspaces/${WS_ID}/taxonomy-edges`, authed());
    expect(res.status).toBe(200);
    const body = (await res.json()) as typeof baseEdge[];
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ id: EDGE_ID, sourceNodeId: NODE_A, targetNodeId: NODE_B });
  });

  it("returns 404 when workspace not found", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue(null);

    const res = await app.request(`/workspaces/nope/taxonomy-edges`, authed());
    expect(res.status).toBe(404);
  });
});

// ─── POST ─────────────────────────────────────────────────────────────────────

describe("POST /workspaces/:workspaceId/taxonomy-edges", () => {
  function setupValidNodes() {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: WS_ID } as never);
    vi.mocked(db.taxonomyNode.findUnique)
      .mockResolvedValueOnce(nodeA as never)
      .mockResolvedValueOnce(nodeB as never);
    vi.mocked(db.taxonomyEdge.findFirst).mockResolvedValue(null);
    vi.mocked(db.taxonomyEdge.findMany).mockResolvedValue([]);
  }

  it("creates an edge with source and target", async () => {
    setupValidNodes();
    vi.mocked(db.taxonomyEdge.create).mockResolvedValue(baseEdge as never);

    const res = await post(`/workspaces/${WS_ID}/taxonomy-edges`, {
      sourceNodeId: NODE_A,
      targetNodeId: NODE_B,
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as typeof baseEdge;
    expect(body).toMatchObject({ id: EDGE_ID, sourceNodeId: NODE_A, targetNodeId: NODE_B });
  });

  it("returns 400 when sourceNodeId is missing", async () => {
    const res = await post(`/workspaces/${WS_ID}/taxonomy-edges`, {
      targetNodeId: NODE_B,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Validation error");
  });

  it("returns 400 when targetNodeId is missing", async () => {
    const res = await post(`/workspaces/${WS_ID}/taxonomy-edges`, {
      sourceNodeId: NODE_A,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Validation error");
  });

  it("returns 404 when workspace does not exist", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue(null);

    const res = await post(`/workspaces/nope/taxonomy-edges`, {
      sourceNodeId: NODE_A,
      targetNodeId: NODE_B,
    });
    expect(res.status).toBe(404);
  });

  it("returns 404 when source node not found", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: WS_ID } as never);
    vi.mocked(db.taxonomyNode.findUnique)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(nodeB as never);

    const res = await post(`/workspaces/${WS_ID}/taxonomy-edges`, {
      sourceNodeId: "nope",
      targetNodeId: NODE_B,
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/source/i);
  });

  it("returns 404 when target node not found", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: WS_ID } as never);
    vi.mocked(db.taxonomyNode.findUnique)
      .mockResolvedValueOnce(nodeA as never)
      .mockResolvedValueOnce(null);

    const res = await post(`/workspaces/${WS_ID}/taxonomy-edges`, {
      sourceNodeId: NODE_A,
      targetNodeId: "nope",
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/target/i);
  });

  it("returns 422 when target is the root node", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: WS_ID } as never);
    vi.mocked(db.taxonomyNode.findUnique)
      .mockResolvedValueOnce(nodeA as never)
      .mockResolvedValueOnce(rootNode as never);

    const res = await post(`/workspaces/${WS_ID}/taxonomy-edges`, {
      sourceNodeId: NODE_A,
      targetNodeId: rootNode.id,
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/root/i);
  });

  it("returns 422 when the source is the catch-all (it must stay a leaf)", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: WS_ID } as never);
    vi.mocked(db.taxonomyNode.findUnique)
      .mockResolvedValueOnce(catchAllNode as never) // source
      .mockResolvedValueOnce(nodeB as never);       // target

    const res = await post(`/workspaces/${WS_ID}/taxonomy-edges`, {
      sourceNodeId: catchAllNode.id,
      targetNodeId: NODE_B,
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/catch-all/i);
  });

  it("returns 422 when a non-root node targets the catch-all", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: WS_ID } as never);
    vi.mocked(db.taxonomyNode.findUnique)
      .mockResolvedValueOnce(nodeA as never)         // source (non-root)
      .mockResolvedValueOnce(catchAllNode as never); // target (catch-all)

    const res = await post(`/workspaces/${WS_ID}/taxonomy-edges`, {
      sourceNodeId: NODE_A,
      targetNodeId: catchAllNode.id,
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/directly to the Inbox/i);
  });

  it("returns 422 when a duplicate edge already exists", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: WS_ID } as never);
    vi.mocked(db.taxonomyNode.findUnique)
      .mockResolvedValueOnce(nodeA as never)
      .mockResolvedValueOnce(nodeB as never);
    vi.mocked(db.taxonomyEdge.findFirst).mockResolvedValue(baseEdge as never);

    const res = await post(`/workspaces/${WS_ID}/taxonomy-edges`, {
      sourceNodeId: NODE_A,
      targetNodeId: NODE_B,
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/already exists/i);
  });

  it("returns 422 when the target node already has a parent", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: WS_ID } as never);
    vi.mocked(db.taxonomyNode.findUnique)
      .mockResolvedValueOnce(nodeC as never)  // source
      .mockResolvedValueOnce(nodeB as never); // target
    // duplicate check → null (C→B doesn't exist), incoming check → baseEdge (A→B exists)
    vi.mocked(db.taxonomyEdge.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(baseEdge as never);

    const res = await post(`/workspaces/${WS_ID}/taxonomy-edges`, {
      sourceNodeId: NODE_C,
      targetNodeId: NODE_B,
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/already has a parent/i);
  });

  it("returns 422 when the edge would create a cycle (A→B→C + C→A)", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: WS_ID } as never);
    vi.mocked(db.taxonomyNode.findUnique)
      .mockResolvedValueOnce(nodeC as never)
      .mockResolvedValueOnce(nodeA as never);
    vi.mocked(db.taxonomyEdge.findFirst).mockResolvedValue(null);
    // Existing edges: A→B and B→C
    vi.mocked(db.taxonomyEdge.findMany).mockResolvedValue([
      { sourceNodeId: NODE_A, targetNodeId: NODE_B },
      { sourceNodeId: NODE_B, targetNodeId: NODE_C },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any);

    const res = await post(`/workspaces/${WS_ID}/taxonomy-edges`, {
      sourceNodeId: NODE_C,
      targetNodeId: NODE_A,
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/cycle/i);
  });

  it("returns 422 for a self-loop", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: WS_ID } as never);
    vi.mocked(db.taxonomyNode.findUnique)
      .mockResolvedValueOnce(nodeA as never)
      .mockResolvedValueOnce(nodeA as never);
    vi.mocked(db.taxonomyEdge.findFirst).mockResolvedValue(null);
    vi.mocked(db.taxonomyEdge.findMany).mockResolvedValue([]);

    const res = await post(`/workspaces/${WS_ID}/taxonomy-edges`, {
      sourceNodeId: NODE_A,
      targetNodeId: NODE_A,
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/cycle/i);
  });

  it("allows an edge when no cycle is introduced", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: WS_ID } as never);
    vi.mocked(db.taxonomyNode.findUnique)
      .mockResolvedValueOnce(nodeA as never)
      .mockResolvedValueOnce(nodeC as never);
    vi.mocked(db.taxonomyEdge.findFirst).mockResolvedValue(null);
    // Existing edges: A→B and B→C — adding A→C is fine (not a cycle)
    vi.mocked(db.taxonomyEdge.findMany).mockResolvedValue([
      { sourceNodeId: NODE_A, targetNodeId: NODE_B },
      { sourceNodeId: NODE_B, targetNodeId: NODE_C },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any);
    vi.mocked(db.taxonomyEdge.create).mockResolvedValue({
      ...baseEdge,
      targetNodeId: NODE_C,
    } as never);

    const res = await post(`/workspaces/${WS_ID}/taxonomy-edges`, {
      sourceNodeId: NODE_A,
      targetNodeId: NODE_C,
    });
    expect(res.status).toBe(201);
  });
});

// ─── PATCH ────────────────────────────────────────────────────────────────────

describe("PATCH /workspaces/:workspaceId/taxonomy-edges/:edgeId", () => {
  it("returns the unchanged edge when no newSourceNodeId is provided", async () => {
    vi.mocked(db.taxonomyEdge.findUnique).mockResolvedValue(baseEdge as never);

    const res = await patch(`/workspaces/${WS_ID}/taxonomy-edges/${EDGE_ID}`, {});
    expect(res.status).toBe(200);
    const body = (await res.json()) as typeof baseEdge;
    expect(body).toMatchObject({ id: EDGE_ID, sourceNodeId: NODE_A, targetNodeId: NODE_B });
  });

  it("returns the unchanged edge when newSourceNodeId equals the current source", async () => {
    vi.mocked(db.taxonomyEdge.findUnique).mockResolvedValue(baseEdge as never);

    const res = await patch(`/workspaces/${WS_ID}/taxonomy-edges/${EDGE_ID}`, {
      newSourceNodeId: NODE_A,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as typeof baseEdge;
    expect(body).toMatchObject({ id: EDGE_ID });
  });

  it("re-parents the edge and returns the new edge", async () => {
    const reparentedEdge = { ...baseEdge, id: "edge-new", sourceNodeId: NODE_C };
    vi.mocked(db.taxonomyEdge.findUnique).mockResolvedValue(baseEdge as never);
    vi.mocked(db.taxonomyNode.findUnique).mockResolvedValue(nodeC as never);
    vi.mocked(db.taxonomyEdge.findFirst).mockResolvedValue(null);
    vi.mocked(db.taxonomyEdge.findMany).mockResolvedValue([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation((fn: any) => fn(db));
    vi.mocked(db.taxonomyEdge.delete).mockResolvedValue(baseEdge as never);
    vi.mocked(db.taxonomyEdge.create).mockResolvedValue(reparentedEdge as never);

    const res = await patch(`/workspaces/${WS_ID}/taxonomy-edges/${EDGE_ID}`, {
      newSourceNodeId: NODE_C,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as typeof reparentedEdge;
    expect(body).toMatchObject({ sourceNodeId: NODE_C, targetNodeId: NODE_B });
    expect(vi.mocked(db.taxonomyEdge.delete)).toHaveBeenCalledWith({ where: { id: EDGE_ID } });
    expect(vi.mocked(db.taxonomyEdge.create)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ sourceNodeId: NODE_C, targetNodeId: NODE_B }),
      })
    );
  });

  it("returns 404 when edge does not exist", async () => {
    vi.mocked(db.taxonomyEdge.findUnique).mockResolvedValue(null);

    const res = await patch(`/workspaces/${WS_ID}/taxonomy-edges/nope`, {});
    expect(res.status).toBe(404);
  });

  it("returns 404 when edge belongs to a different workspace", async () => {
    vi.mocked(db.taxonomyEdge.findUnique).mockResolvedValue(
      { ...baseEdge, workspaceId: "other-ws" } as never
    );

    const res = await patch(`/workspaces/${WS_ID}/taxonomy-edges/${EDGE_ID}`, {});
    expect(res.status).toBe(404);
  });

  it("returns 404 when the new source node does not exist", async () => {
    vi.mocked(db.taxonomyEdge.findUnique).mockResolvedValue(baseEdge as never);
    vi.mocked(db.taxonomyNode.findUnique).mockResolvedValue(null);

    const res = await patch(`/workspaces/${WS_ID}/taxonomy-edges/${EDGE_ID}`, {
      newSourceNodeId: "nope",
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/source/i);
  });

  it("returns 422 when re-parenting onto the catch-all (it must stay a leaf)", async () => {
    vi.mocked(db.taxonomyEdge.findUnique).mockResolvedValue(baseEdge as never);
    vi.mocked(db.taxonomyNode.findUnique).mockResolvedValue(catchAllNode as never);

    const res = await patch(`/workspaces/${WS_ID}/taxonomy-edges/${EDGE_ID}`, {
      newSourceNodeId: catchAllNode.id,
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/catch-all/i);
  });

  it("returns 422 when re-pointing the catch-all's edge to a non-root parent", async () => {
    vi.mocked(db.taxonomyEdge.findUnique).mockResolvedValue(
      { ...baseEdge, targetNode: { isCatchAll: true } } as never
    );
    vi.mocked(db.taxonomyNode.findUnique).mockResolvedValue(nodeC as never); // non-root

    const res = await patch(`/workspaces/${WS_ID}/taxonomy-edges/${EDGE_ID}`, {
      newSourceNodeId: NODE_C,
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/directly to the Inbox/i);
  });

  it("returns 422 when re-parenting would create a duplicate edge", async () => {
    vi.mocked(db.taxonomyEdge.findUnique).mockResolvedValue(baseEdge as never);
    vi.mocked(db.taxonomyNode.findUnique).mockResolvedValue(nodeC as never);
    vi.mocked(db.taxonomyEdge.findFirst).mockResolvedValue(baseEdge as never);

    const res = await patch(`/workspaces/${WS_ID}/taxonomy-edges/${EDGE_ID}`, {
      newSourceNodeId: NODE_C,
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/already exists/i);
  });

  it("returns 422 when re-parenting would introduce a cycle", async () => {
    // Edge is A→B; trying to move to B→B is a self-loop caught by hasCycle
    vi.mocked(db.taxonomyEdge.findUnique).mockResolvedValue(baseEdge as never);
    vi.mocked(db.taxonomyNode.findUnique).mockResolvedValue(nodeB as never);
    vi.mocked(db.taxonomyEdge.findFirst).mockResolvedValue(null);
    vi.mocked(db.taxonomyEdge.findMany).mockResolvedValue([]);

    const res = await patch(`/workspaces/${WS_ID}/taxonomy-edges/${EDGE_ID}`, {
      newSourceNodeId: NODE_B,
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/cycle/i);
  });
});

// ─── DELETE ───────────────────────────────────────────────────────────────────

describe("DELETE /workspaces/:workspaceId/taxonomy-edges/:edgeId", () => {
  it("deletes an edge", async () => {
    vi.mocked(db.taxonomyEdge.findUnique).mockResolvedValue(
      { ...baseEdge, targetNode: { isCatchAll: false } } as never
    );
    vi.mocked(db.taxonomyEdge.delete).mockResolvedValue(baseEdge as never);

    const res = await del(`/workspaces/${WS_ID}/taxonomy-edges/${EDGE_ID}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("returns 422 when deleting the catch-all's incoming edge", async () => {
    vi.mocked(db.taxonomyEdge.findUnique).mockResolvedValue(
      { ...baseEdge, targetNode: { isCatchAll: true } } as never
    );

    const res = await del(`/workspaces/${WS_ID}/taxonomy-edges/${EDGE_ID}`);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/catch-all/i);
    expect(vi.mocked(db.taxonomyEdge.delete)).not.toHaveBeenCalled();
  });

  it("returns 404 when edge does not exist", async () => {
    vi.mocked(db.taxonomyEdge.findUnique).mockResolvedValue(null);

    const res = await del(`/workspaces/${WS_ID}/taxonomy-edges/nope`);
    expect(res.status).toBe(404);
  });

  it("returns 404 when edge belongs to a different workspace", async () => {
    vi.mocked(db.taxonomyEdge.findUnique).mockResolvedValue(
      { ...baseEdge, workspaceId: "other-ws" } as never
    );

    const res = await del(`/workspaces/${WS_ID}/taxonomy-edges/${EDGE_ID}`);
    expect(res.status).toBe(404);
  });
});
