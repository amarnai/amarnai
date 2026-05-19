import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@genizor/db", () => ({
  db: {
    workspace: {
      findUnique: vi.fn(),
    },
    taxonomyNode: {
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
const NODE_ID = "node-1";

// A description that meets all constraints: >= 20 chars, <= 300 chars, no HTML,
// not identical to any test node name.
const VALID_DESCRIPTION = "A valid description for testing purposes";

const baseNode = {
  id: NODE_ID,
  workspaceId: WS_ID,
  name: "Inbox",
  description: null,
  instructions: null,
  examples: [],
  isRoot: false,
  isVisibleCategory: false,
  canReceiveEmails: false,
  positionX: 0,
  positionY: 0,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

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

describe("GET /workspaces/:workspaceId/taxonomy-nodes", () => {
  it("returns nodes for a workspace including isRoot", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({
      taxonomyNodes: [{ ...baseNode, isRoot: true }],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const res = await app.request(`/workspaces/${WS_ID}/taxonomy-nodes`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as typeof baseNode[];
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ id: NODE_ID, name: "Inbox", isRoot: true });
  });

  it("returns legacy nodes with null description without error", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({
      taxonomyNodes: [{ ...baseNode, description: null }],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const res = await app.request(`/workspaces/${WS_ID}/taxonomy-nodes`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as typeof baseNode[];
    expect(body[0]?.description).toBeNull();
  });

  it("returns 404 when workspace not found", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue(null);

    const res = await app.request(`/workspaces/nope/taxonomy-nodes`);
    expect(res.status).toBe(404);
  });
});

// ─── POST ─────────────────────────────────────────────────────────────────────

describe("POST /workspaces/:workspaceId/taxonomy-nodes", () => {
  it("creates a non-root node with valid name and description", async () => {
    const created = { ...baseNode, name: "Clients", description: VALID_DESCRIPTION };
    vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: WS_ID } as never);
    vi.mocked(db.taxonomyNode.create).mockResolvedValue(created as never);

    const res = await post(`/workspaces/${WS_ID}/taxonomy-nodes`, {
      name: "Clients",
      description: VALID_DESCRIPTION,
    });
    expect(res.status).toBe(201);
    const body = await res.json() as typeof created;
    expect(body).toMatchObject({ id: NODE_ID, name: "Clients", description: VALID_DESCRIPTION });
  });

  it("creates a node with optional fields alongside required description", async () => {
    const full = {
      ...baseNode,
      name: "Clients",
      description: VALID_DESCRIPTION,
      isVisibleCategory: true,
      canReceiveEmails: true,
      examples: ["ex1"],
    };
    vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: WS_ID } as never);
    vi.mocked(db.taxonomyNode.create).mockResolvedValue(full as never);

    const res = await post(`/workspaces/${WS_ID}/taxonomy-nodes`, {
      name: "Clients",
      description: VALID_DESCRIPTION,
      isVisibleCategory: true,
      canReceiveEmails: true,
      examples: ["ex1"],
    });
    expect(res.status).toBe(201);
    const body = await res.json() as typeof full;
    expect(body.isVisibleCategory).toBe(true);
    expect(body.examples).toEqual(["ex1"]);
  });

  it("trims name and description whitespace before saving", async () => {
    const created = { ...baseNode, name: "Clients", description: VALID_DESCRIPTION };
    vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: WS_ID } as never);
    vi.mocked(db.taxonomyNode.create).mockResolvedValue(created as never);

    const res = await post(`/workspaces/${WS_ID}/taxonomy-nodes`, {
      name: "  Clients  ",
      description: `  ${VALID_DESCRIPTION}  `,
    });
    expect(res.status).toBe(201);
    // Confirm the create was called (trimmed values passed schema validation)
    expect(vi.mocked(db.taxonomyNode.create)).toHaveBeenCalledTimes(1);
  });

  it("returns 400 when description is missing", async () => {
    const res = await post(`/workspaces/${WS_ID}/taxonomy-nodes`, {
      name: "Clients",
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("Validation error");
  });

  it("returns 400 when description is under 20 characters", async () => {
    const res = await post(`/workspaces/${WS_ID}/taxonomy-nodes`, {
      name: "Clients",
      description: "Too short",
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string; issues: unknown[] };
    expect(body.error).toBe("Validation error");
    const issueMessages = (body.issues as Array<{ message: string }>).map((i) => i.message);
    expect(issueMessages.some((m) => m.toLowerCase().includes("20"))).toBe(true);
  });

  it("returns 400 when description is over 300 characters", async () => {
    const res = await post(`/workspaces/${WS_ID}/taxonomy-nodes`, {
      name: "Clients",
      description: "x".repeat(301),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when description is identical to name (case-insensitive)", async () => {
    const res = await post(`/workspaces/${WS_ID}/taxonomy-nodes`, {
      name: "Clients",
      description: "clients",
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string; issues: unknown[] };
    const issueMessages = (body.issues as Array<{ message: string }>).map((i) => i.message);
    expect(issueMessages.some((m) => m.toLowerCase().includes("ai sorting quality"))).toBe(true);
  });

  it("returns 400 when description contains HTML", async () => {
    const res = await post(`/workspaces/${WS_ID}/taxonomy-nodes`, {
      name: "Clients",
      description: "<b>Emails from clients</b> and stakeholders in active projects",
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string; issues: unknown[] };
    const issueMessages = (body.issues as Array<{ message: string }>).map((i) => i.message);
    expect(issueMessages.some((m) => m.toLowerCase().includes("html"))).toBe(true);
  });

  it("returns 400 when name is missing", async () => {
    const res = await post(`/workspaces/${WS_ID}/taxonomy-nodes`, {
      description: VALID_DESCRIPTION,
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("Validation error");
  });

  it("returns 400 when name is under 3 characters", async () => {
    const res = await post(`/workspaces/${WS_ID}/taxonomy-nodes`, {
      name: "AB",
      description: VALID_DESCRIPTION,
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string; issues: unknown[] };
    const issueMessages = (body.issues as Array<{ message: string }>).map((i) => i.message);
    expect(issueMessages.some((m) => m.toLowerCase().includes("3"))).toBe(true);
  });

  it("returns 400 when name is over 60 characters", async () => {
    const res = await post(`/workspaces/${WS_ID}/taxonomy-nodes`, {
      name: "a".repeat(61),
      description: VALID_DESCRIPTION,
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when name contains only punctuation or symbols", async () => {
    const res = await post(`/workspaces/${WS_ID}/taxonomy-nodes`, {
      name: "!!!",
      description: VALID_DESCRIPTION,
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string; issues: unknown[] };
    const issueMessages = (body.issues as Array<{ message: string }>).map((i) => i.message);
    expect(issueMessages.some((m) => m.toLowerCase().includes("letter or digit"))).toBe(true);
  });

  it("returns 404 when workspace does not exist", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue(null);

    const res = await post(`/workspaces/nope/taxonomy-nodes`, {
      name: "Clients",
      description: VALID_DESCRIPTION,
    });
    expect(res.status).toBe(404);
  });
});

// ─── PATCH ────────────────────────────────────────────────────────────────────

describe("PATCH /workspaces/:workspaceId/taxonomy-nodes/:nodeId", () => {
  it("updates a node's name", async () => {
    const updated = { ...baseNode, name: "Renamed" };
    vi.mocked(db.taxonomyNode.findUnique).mockResolvedValue(baseNode as never);
    vi.mocked(db.taxonomyNode.update).mockResolvedValue(updated as never);

    const res = await patch(
      `/workspaces/${WS_ID}/taxonomy-nodes/${NODE_ID}`,
      { name: "Renamed" }
    );
    expect(res.status).toBe(200);
    const body = await res.json() as typeof updated;
    expect(body.name).toBe("Renamed");
  });

  it("updates boolean flags", async () => {
    const updated = { ...baseNode, isVisibleCategory: true, canReceiveEmails: true };
    vi.mocked(db.taxonomyNode.findUnique).mockResolvedValue(baseNode as never);
    vi.mocked(db.taxonomyNode.update).mockResolvedValue(updated as never);

    const res = await patch(
      `/workspaces/${WS_ID}/taxonomy-nodes/${NODE_ID}`,
      { isVisibleCategory: true, canReceiveEmails: true }
    );
    expect(res.status).toBe(200);
    const body = await res.json() as typeof updated;
    expect(body.isVisibleCategory).toBe(true);
  });

  it("allows updating a non-root node's description to a valid value", async () => {
    const updated = { ...baseNode, description: VALID_DESCRIPTION };
    vi.mocked(db.taxonomyNode.findUnique).mockResolvedValue(baseNode as never);
    vi.mocked(db.taxonomyNode.update).mockResolvedValue(updated as never);

    const res = await patch(
      `/workspaces/${WS_ID}/taxonomy-nodes/${NODE_ID}`,
      { description: VALID_DESCRIPTION }
    );
    expect(res.status).toBe(200);
    const body = await res.json() as typeof updated;
    expect(body.description).toBe(VALID_DESCRIPTION);
  });

  it("allows updating a non-root legacy node's name without providing description", async () => {
    // Legacy nodes with null descriptions must not fail on PATCH when description is omitted.
    const updated = { ...baseNode, name: "New Name" };
    vi.mocked(db.taxonomyNode.findUnique).mockResolvedValue(baseNode as never);
    vi.mocked(db.taxonomyNode.update).mockResolvedValue(updated as never);

    const res = await patch(
      `/workspaces/${WS_ID}/taxonomy-nodes/${NODE_ID}`,
      { name: "New Name" }
    );
    expect(res.status).toBe(200);
    const body = await res.json() as typeof updated;
    expect(body.name).toBe("New Name");
  });

  it("trims name and description on update", async () => {
    const updated = { ...baseNode, name: "Renamed", description: VALID_DESCRIPTION };
    vi.mocked(db.taxonomyNode.findUnique).mockResolvedValue(baseNode as never);
    vi.mocked(db.taxonomyNode.update).mockResolvedValue(updated as never);

    const res = await patch(
      `/workspaces/${WS_ID}/taxonomy-nodes/${NODE_ID}`,
      { name: "  Renamed  ", description: `  ${VALID_DESCRIPTION}  ` }
    );
    expect(res.status).toBe(200);
  });

  it("returns 400 when updated description is under 20 characters", async () => {
    vi.mocked(db.taxonomyNode.findUnique).mockResolvedValue(baseNode as never);

    const res = await patch(
      `/workspaces/${WS_ID}/taxonomy-nodes/${NODE_ID}`,
      { description: "Too short" }
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("Validation error");
  });

  it("returns 400 when updated description is over 300 characters", async () => {
    vi.mocked(db.taxonomyNode.findUnique).mockResolvedValue(baseNode as never);

    const res = await patch(
      `/workspaces/${WS_ID}/taxonomy-nodes/${NODE_ID}`,
      { description: "x".repeat(301) }
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when updated description contains HTML", async () => {
    vi.mocked(db.taxonomyNode.findUnique).mockResolvedValue(baseNode as never);

    const res = await patch(
      `/workspaces/${WS_ID}/taxonomy-nodes/${NODE_ID}`,
      { description: "<p>Emails from clients</p> and other stakeholders we track" }
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string; issues: unknown[] };
    const issueMessages = (body.issues as Array<{ message: string }>).map((i) => i.message);
    expect(issueMessages.some((m) => m.toLowerCase().includes("html"))).toBe(true);
  });

  it("returns 400 when updated description is identical to updated name (case-insensitive)", async () => {
    // Both name and description present in same PATCH — cross-field check applies.
    const res = await patch(
      `/workspaces/${WS_ID}/taxonomy-nodes/${NODE_ID}`,
      { name: "Finance", description: "finance" }
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string; issues: unknown[] };
    const issueMessages = (body.issues as Array<{ message: string }>).map((i) => i.message);
    expect(issueMessages.some((m) => m.toLowerCase().includes("ai sorting quality"))).toBe(true);
  });

  it("returns 404 when node does not exist", async () => {
    vi.mocked(db.taxonomyNode.findUnique).mockResolvedValue(null);

    const res = await patch(`/workspaces/${WS_ID}/taxonomy-nodes/nope`, {
      name: "New Name",
    });
    expect(res.status).toBe(404);
  });

  it("returns 404 when node belongs to a different workspace", async () => {
    vi.mocked(db.taxonomyNode.findUnique).mockResolvedValue(
      { ...baseNode, workspaceId: "other-ws" } as never
    );

    const res = await patch(
      `/workspaces/${WS_ID}/taxonomy-nodes/${NODE_ID}`,
      { name: "New Name" }
    );
    expect(res.status).toBe(404);
  });

  it("returns 400 when body includes isRoot", async () => {
    const res = await patch(
      `/workspaces/${WS_ID}/taxonomy-nodes/${NODE_ID}`,
      { isRoot: false }
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/isRoot/i);
  });

  it("returns 422 when changing isVisibleCategory on the root node", async () => {
    vi.mocked(db.taxonomyNode.findUnique).mockResolvedValue(
      { ...baseNode, isRoot: true } as never
    );

    const res = await patch(
      `/workspaces/${WS_ID}/taxonomy-nodes/${NODE_ID}`,
      { isVisibleCategory: false }
    );
    expect(res.status).toBe(422);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/isVisibleCategory/i);
  });

  it("returns 422 when changing canReceiveEmails on the root node", async () => {
    vi.mocked(db.taxonomyNode.findUnique).mockResolvedValue(
      { ...baseNode, isRoot: true } as never
    );

    const res = await patch(
      `/workspaces/${WS_ID}/taxonomy-nodes/${NODE_ID}`,
      { canReceiveEmails: false }
    );
    expect(res.status).toBe(422);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/canReceiveEmails/i);
  });

  it("allows other field changes on the root node", async () => {
    const updated = { ...baseNode, name: "Renamed Root", isRoot: true };
    vi.mocked(db.taxonomyNode.findUnique).mockResolvedValue(
      { ...baseNode, isRoot: true } as never
    );
    vi.mocked(db.taxonomyNode.update).mockResolvedValue(updated as never);

    const res = await patch(
      `/workspaces/${WS_ID}/taxonomy-nodes/${NODE_ID}`,
      { name: "Renamed Root" }
    );
    expect(res.status).toBe(200);
    const body = await res.json() as typeof updated;
    expect(body.name).toBe("Renamed Root");
  });

  it("root Inbox can be patched without providing a description", async () => {
    // Root node bypasses the "description required" rule.
    const updated = { ...baseNode, name: "Inbox", isRoot: true };
    vi.mocked(db.taxonomyNode.findUnique).mockResolvedValue(
      { ...baseNode, isRoot: true } as never
    );
    vi.mocked(db.taxonomyNode.update).mockResolvedValue(updated as never);

    const res = await patch(
      `/workspaces/${WS_ID}/taxonomy-nodes/${NODE_ID}`,
      { name: "Inbox" }
    );
    expect(res.status).toBe(200);
  });
});

// ─── DELETE ───────────────────────────────────────────────────────────────────

describe("DELETE /workspaces/:workspaceId/taxonomy-nodes/:nodeId", () => {
  it("deletes a node with no edges and no classifications", async () => {
    vi.mocked(db.taxonomyNode.findUnique).mockResolvedValue(
      { ...baseNode, _count: { outgoingEdges: 0, incomingEdges: 0, classifications: 0 } } as never
    );
    vi.mocked(db.taxonomyNode.delete).mockResolvedValue(baseNode as never);

    const res = await del(`/workspaces/${WS_ID}/taxonomy-nodes/${NODE_ID}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("returns 422 when node is the root node", async () => {
    vi.mocked(db.taxonomyNode.findUnique).mockResolvedValue(
      { ...baseNode, isRoot: true, _count: { outgoingEdges: 0, incomingEdges: 0, classifications: 0 } } as never
    );

    const res = await del(`/workspaces/${WS_ID}/taxonomy-nodes/${NODE_ID}`);
    expect(res.status).toBe(422);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/root/i);
  });

  it("returns 422 when node has outgoing edges", async () => {
    vi.mocked(db.taxonomyNode.findUnique).mockResolvedValue(
      { ...baseNode, _count: { outgoingEdges: 2, incomingEdges: 0, classifications: 0 } } as never
    );

    const res = await del(`/workspaces/${WS_ID}/taxonomy-nodes/${NODE_ID}`);
    expect(res.status).toBe(422);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/edge/i);
  });

  it("returns 422 when node has incoming edges", async () => {
    vi.mocked(db.taxonomyNode.findUnique).mockResolvedValue(
      { ...baseNode, _count: { outgoingEdges: 0, incomingEdges: 1, classifications: 0 } } as never
    );

    const res = await del(`/workspaces/${WS_ID}/taxonomy-nodes/${NODE_ID}`);
    expect(res.status).toBe(422);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/edge/i);
  });

  it("returns 422 when node has email classifications", async () => {
    vi.mocked(db.taxonomyNode.findUnique).mockResolvedValue(
      { ...baseNode, _count: { outgoingEdges: 0, incomingEdges: 0, classifications: 3 } } as never
    );

    const res = await del(`/workspaces/${WS_ID}/taxonomy-nodes/${NODE_ID}`);
    expect(res.status).toBe(422);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/classification/i);
  });

  it("returns 404 when node does not exist", async () => {
    vi.mocked(db.taxonomyNode.findUnique).mockResolvedValue(null);

    const res = await del(`/workspaces/${WS_ID}/taxonomy-nodes/nope`);
    expect(res.status).toBe(404);
  });

  it("returns 404 when node belongs to a different workspace", async () => {
    vi.mocked(db.taxonomyNode.findUnique).mockResolvedValue(
      {
        ...baseNode,
        workspaceId: "other-ws",
        _count: { outgoingEdges: 0, incomingEdges: 0, classifications: 0 },
      } as never
    );

    const res = await del(`/workspaces/${WS_ID}/taxonomy-nodes/${NODE_ID}`);
    expect(res.status).toBe(404);
  });
});
