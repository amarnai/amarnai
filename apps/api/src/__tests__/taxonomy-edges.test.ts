import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@genizor/db", () => ({
  db: {
    workspace: {
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
  },
}));

import app from "../app.js";
import { db } from "@genizor/db";

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
  sortingQuestion: "Is this urgent?",
  examples: [],
  negativeExamples: [],
  priority: 0,
  confidenceThreshold: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const nodeA = { id: NODE_A, workspaceId: WS_ID, isRoot: false };
const nodeB = { id: NODE_B, workspaceId: WS_ID, isRoot: false };
const nodeC = { id: NODE_C, workspaceId: WS_ID, isRoot: false };
const rootNode = { id: "root-1", workspaceId: WS_ID, isRoot: true };

function post(path: string, body: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function patch(path: string, body: unknown) {
  return app.request(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function del(path: string) {
  return app.request(path, { method: "DELETE" });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── GET ─────────────────────────────────────────────────────────────────────

describe("GET /workspaces/:workspaceId/taxonomy-edges", () => {
  it("returns edges for a workspace", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({
      taxonomyEdges: [baseEdge],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const res = await app.request(`/workspaces/${WS_ID}/taxonomy-edges`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as typeof baseEdge[];
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ id: EDGE_ID, sortingQuestion: "Is this urgent?" });
  });

  it("returns 404 when workspace not found", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue(null);

    const res = await app.request(`/workspaces/nope/taxonomy-edges`);
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

  it("creates an edge with minimal fields", async () => {
    setupValidNodes();
    vi.mocked(db.taxonomyEdge.create).mockResolvedValue(baseEdge as never);

    const res = await post(`/workspaces/${WS_ID}/taxonomy-edges`, {
      sourceNodeId: NODE_A,
      targetNodeId: NODE_B,
      sortingQuestion: "Is this urgent?",
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as typeof baseEdge;
    expect(body).toMatchObject({ id: EDGE_ID, sortingQuestion: "Is this urgent?" });
  });

  it("creates an edge with all optional fields", async () => {
    setupValidNodes();
    const full = {
      ...baseEdge,
      examples: ["ex1"],
      negativeExamples: ["nex1"],
      priority: 5,
      confidenceThreshold: 0.8,
    };
    vi.mocked(db.taxonomyEdge.create).mockResolvedValue(full as never);

    const res = await post(`/workspaces/${WS_ID}/taxonomy-edges`, {
      sourceNodeId: NODE_A,
      targetNodeId: NODE_B,
      sortingQuestion: "Is this urgent?",
      examples: ["ex1"],
      negativeExamples: ["nex1"],
      priority: 5,
      confidenceThreshold: 0.8,
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as typeof full;
    expect(body.priority).toBe(5);
    expect(body.confidenceThreshold).toBe(0.8);
  });

  it("returns 400 when sortingQuestion is missing", async () => {
    const res = await post(`/workspaces/${WS_ID}/taxonomy-edges`, {
      sourceNodeId: NODE_A,
      targetNodeId: NODE_B,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Validation error");
  });

  it("returns 400 when sortingQuestion exceeds 160 characters", async () => {
    const res = await post(`/workspaces/${WS_ID}/taxonomy-edges`, {
      sourceNodeId: NODE_A,
      targetNodeId: NODE_B,
      sortingQuestion: "a".repeat(161),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Validation error");
  });

  it("returns 400 when confidenceThreshold is out of range", async () => {
    const res = await post(`/workspaces/${WS_ID}/taxonomy-edges`, {
      sourceNodeId: NODE_A,
      targetNodeId: NODE_B,
      sortingQuestion: "?",
      confidenceThreshold: 1.5,
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 when workspace does not exist", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue(null);

    const res = await post(`/workspaces/nope/taxonomy-edges`, {
      sourceNodeId: NODE_A,
      targetNodeId: NODE_B,
      sortingQuestion: "?",
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
      sortingQuestion: "?",
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
      sortingQuestion: "?",
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
      sortingQuestion: "?",
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/root/i);
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
      sortingQuestion: "?",
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/already exists/i);
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
      sortingQuestion: "?",
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
      sortingQuestion: "?",
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
      sortingQuestion: "?",
    });
    expect(res.status).toBe(201);
  });
});

// ─── PATCH ────────────────────────────────────────────────────────────────────

describe("PATCH /workspaces/:workspaceId/taxonomy-edges/:edgeId", () => {
  it("updates the sorting question", async () => {
    const updated = { ...baseEdge, sortingQuestion: "Updated?" };
    vi.mocked(db.taxonomyEdge.findUnique).mockResolvedValue(baseEdge as never);
    vi.mocked(db.taxonomyEdge.update).mockResolvedValue(updated as never);

    const res = await patch(
      `/workspaces/${WS_ID}/taxonomy-edges/${EDGE_ID}`,
      { sortingQuestion: "Updated?" }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as typeof updated;
    expect(body.sortingQuestion).toBe("Updated?");
  });

  it("updates priority and confidenceThreshold", async () => {
    const updated = { ...baseEdge, priority: 3, confidenceThreshold: 0.75 };
    vi.mocked(db.taxonomyEdge.findUnique).mockResolvedValue(baseEdge as never);
    vi.mocked(db.taxonomyEdge.update).mockResolvedValue(updated as never);

    const res = await patch(
      `/workspaces/${WS_ID}/taxonomy-edges/${EDGE_ID}`,
      { priority: 3, confidenceThreshold: 0.75 }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as typeof updated;
    expect(body.priority).toBe(3);
    expect(body.confidenceThreshold).toBe(0.75);
  });

  it("returns 404 when edge does not exist", async () => {
    vi.mocked(db.taxonomyEdge.findUnique).mockResolvedValue(null);

    const res = await patch(
      `/workspaces/${WS_ID}/taxonomy-edges/nope`,
      { sortingQuestion: "?" }
    );
    expect(res.status).toBe(404);
  });

  it("returns 404 when edge belongs to a different workspace", async () => {
    vi.mocked(db.taxonomyEdge.findUnique).mockResolvedValue(
      { ...baseEdge, workspaceId: "other-ws" } as never
    );

    const res = await patch(
      `/workspaces/${WS_ID}/taxonomy-edges/${EDGE_ID}`,
      { sortingQuestion: "?" }
    );
    expect(res.status).toBe(404);
  });

  it("returns 400 when sortingQuestion is empty", async () => {
    vi.mocked(db.taxonomyEdge.findUnique).mockResolvedValue(baseEdge as never);

    const res = await patch(
      `/workspaces/${WS_ID}/taxonomy-edges/${EDGE_ID}`,
      { sortingQuestion: "" }
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when sortingQuestion exceeds 160 characters", async () => {
    vi.mocked(db.taxonomyEdge.findUnique).mockResolvedValue(baseEdge as never);

    const res = await patch(
      `/workspaces/${WS_ID}/taxonomy-edges/${EDGE_ID}`,
      { sortingQuestion: "a".repeat(161) }
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Validation error");
  });
});

// ─── DELETE ───────────────────────────────────────────────────────────────────

describe("DELETE /workspaces/:workspaceId/taxonomy-edges/:edgeId", () => {
  it("deletes an edge", async () => {
    vi.mocked(db.taxonomyEdge.findUnique).mockResolvedValue(baseEdge as never);
    vi.mocked(db.taxonomyEdge.delete).mockResolvedValue(baseEdge as never);

    const res = await del(`/workspaces/${WS_ID}/taxonomy-edges/${EDGE_ID}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
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
