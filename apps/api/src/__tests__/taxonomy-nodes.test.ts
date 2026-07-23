import { vi, describe, it, expect, beforeEach } from "vitest";
import { MAX_TAXONOMY_NON_ROOT_NODES } from "@amarnai/shared";
import { authed } from "./helpers.js";

vi.mock("@amarnai/db", () => ({
  db: {
    $queryRaw: vi.fn(),
    workspace: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    workspaceMember: {
      findUnique: vi.fn(),
    },
    taxonomyNode: {
      findUnique: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    taxonomyEdge: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    taxonomyNodeReference: {
      deleteMany: vi.fn(),
    },
    emailClassification: {
      updateMany: vi.fn(),
    },
  },
}));

import app from "../app.js";
import { db } from "@amarnai/db";

const WS_ID = "ws-1";
const NODE_ID = "node-1";

// A description that meets all constraints: >= 30 non-whitespace chars, <= 300 chars, no HTML,
// not identical to any test node name.
const VALID_DESCRIPTION = "A valid description for testing purposes";

const baseNode = {
  id: NODE_ID,
  workspaceId: WS_ID,
  name: "Inbox",
  description: null,
  instructions: null,
  draftPrompt: null,
  examples: [],
  isRoot: false,
  positionX: 0,
  positionY: 0,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

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

function delWithBody(path: string, body: unknown) {
  return app.request(path, authed({
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  // OWNER by default: passes both the membership guard and the mount-level
  // taxonomy-editor guard (requireTaxonomyEditor) that gates every write below.
  vi.mocked(db.workspaceMember.findUnique).mockResolvedValue({
    userId: "test-user-1",
    role: "OWNER",
  } as never);
  // Default: no edges → no descendants to invalidate for any name-change test.
  // Individual tests override this when testing descendant invalidation.
  vi.mocked(db.taxonomyEdge.findMany).mockResolvedValue([] as never);
  vi.mocked(db.taxonomyNode.updateMany).mockResolvedValue({ count: 0 } as never);
  vi.mocked(db.$queryRaw).mockResolvedValue([] as never);
  // Default: well under the folder cap, so create tests proceed. Cap tests override.
  vi.mocked(db.taxonomyNode.count).mockResolvedValue(0 as never);
});

// ─── GET ─────────────────────────────────────────────────────────────────────

describe("GET /workspaces/:workspaceId/taxonomy-nodes", () => {
  it("returns nodes for a workspace including isRoot", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({
      taxonomyNodes: [{ ...baseNode, isRoot: true }],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const res = await app.request(`/workspaces/${WS_ID}/taxonomy-nodes`, authed());
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

    const res = await app.request(`/workspaces/${WS_ID}/taxonomy-nodes`, authed());
    expect(res.status).toBe(200);
    const body = (await res.json()) as typeof baseNode[];
    expect(body[0]?.description).toBeNull();
  });

  it("returns 404 when workspace not found", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue(null);

    const res = await app.request(`/workspaces/nope/taxonomy-nodes`, authed());
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
    // A new folder changes routing → bump taxonomyChangedAt.
    expect(vi.mocked(db.workspace.update)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: WS_ID },
        data: expect.objectContaining({ taxonomyChangedAt: expect.any(Date) }),
      })
    );
  });

  it("creates a node with optional fields alongside required description", async () => {
    const full = {
      ...baseNode,
      name: "Clients",
      description: VALID_DESCRIPTION,
      examples: ["ex1"],
    };
    vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: WS_ID } as never);
    vi.mocked(db.taxonomyNode.create).mockResolvedValue(full as never);

    const res = await post(`/workspaces/${WS_ID}/taxonomy-nodes`, {
      name: "Clients",
      description: VALID_DESCRIPTION,
      examples: ["ex1"],
    });
    expect(res.status).toBe(201);
    const body = await res.json() as typeof full;
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

  it("returns 400 when description has fewer than 30 non-whitespace characters", async () => {
    const res = await post(`/workspaces/${WS_ID}/taxonomy-nodes`, {
      name: "Clients",
      description: "Too short desc",
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string; issues: unknown[] };
    expect(body.error).toBe("Validation error");
    const issueMessages = (body.issues as Array<{ message: string }>).map((i) => i.message);
    expect(issueMessages.some((m) => m.toLowerCase().includes("30"))).toBe(true);
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

  it("returns 422 and creates nothing when the folder cap is reached", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: WS_ID } as never);
    vi.mocked(db.taxonomyNode.count).mockResolvedValue(
      MAX_TAXONOMY_NON_ROOT_NODES as never
    );

    const res = await post(`/workspaces/${WS_ID}/taxonomy-nodes`, {
      name: "Clients",
      description: VALID_DESCRIPTION,
    });
    expect(res.status).toBe(422);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/folder limit reached/i);
    expect(vi.mocked(db.taxonomyNode.create)).not.toHaveBeenCalled();
    // Only non-root nodes count toward the cap.
    expect(vi.mocked(db.taxonomyNode.count)).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: WS_ID, isRoot: false } })
    );
  });

  it("creates a node when exactly one under the cap", async () => {
    const created = { ...baseNode, name: "Clients", description: VALID_DESCRIPTION };
    vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: WS_ID } as never);
    vi.mocked(db.taxonomyNode.count).mockResolvedValue(
      (MAX_TAXONOMY_NON_ROOT_NODES - 1) as never
    );
    vi.mocked(db.taxonomyNode.create).mockResolvedValue(created as never);

    const res = await post(`/workspaces/${WS_ID}/taxonomy-nodes`, {
      name: "Clients",
      description: VALID_DESCRIPTION,
    });
    expect(res.status).toBe(201);
    expect(vi.mocked(db.taxonomyNode.create)).toHaveBeenCalledTimes(1);
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

  it("returns 400 when updated description has fewer than 30 non-whitespace characters", async () => {
    vi.mocked(db.taxonomyNode.findUnique).mockResolvedValue(baseNode as never);

    const res = await patch(
      `/workspaces/${WS_ID}/taxonomy-nodes/${NODE_ID}`,
      { description: "Too short desc" }
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

  it("returns 400 when body includes isCatchAll", async () => {
    const res = await patch(
      `/workspaces/${WS_ID}/taxonomy-nodes/${NODE_ID}`,
      { isCatchAll: true }
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/isCatchAll/i);
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

  // ── Embedding invalidation ─────────────────────────────────────────────────

  it("PATCH name change includes embeddingTextHash: null in the main update", async () => {
    const updated = { ...baseNode, name: "Renamed" };
    vi.mocked(db.taxonomyNode.findUnique).mockResolvedValue(baseNode as never);
    vi.mocked(db.taxonomyNode.update).mockResolvedValue(updated as never);

    await patch(`/workspaces/${WS_ID}/taxonomy-nodes/${NODE_ID}`, { name: "Renamed" });

    const [callArg] = vi.mocked(db.taxonomyNode.update).mock.calls;
    expect(callArg![0]).toMatchObject({ data: { embeddingTextHash: null, embeddingVector: [] } });
  });

  it("PATCH description change includes embeddingTextHash: null in the main update", async () => {
    const updated = { ...baseNode, description: VALID_DESCRIPTION };
    vi.mocked(db.taxonomyNode.findUnique).mockResolvedValue(baseNode as never);
    vi.mocked(db.taxonomyNode.update).mockResolvedValue(updated as never);

    await patch(`/workspaces/${WS_ID}/taxonomy-nodes/${NODE_ID}`, { description: VALID_DESCRIPTION });

    const [callArg] = vi.mocked(db.taxonomyNode.update).mock.calls;
    expect(callArg![0]).toMatchObject({ data: { embeddingTextHash: null, embeddingVector: [] } });
  });

  it("PATCH description-only change does not call taxonomyEdge.findMany or updateMany", async () => {
    const updated = { ...baseNode, description: VALID_DESCRIPTION };
    vi.mocked(db.taxonomyNode.findUnique).mockResolvedValue(baseNode as never);
    vi.mocked(db.taxonomyNode.update).mockResolvedValue(updated as never);

    const res = await patch(
      `/workspaces/${WS_ID}/taxonomy-nodes/${NODE_ID}`,
      { description: VALID_DESCRIPTION }
    );
    expect(res.status).toBe(200);
    // Description-only: no descendant walk needed
    expect(vi.mocked(db.taxonomyEdge.findMany)).not.toHaveBeenCalled();
    expect(vi.mocked(db.taxonomyNode.updateMany)).not.toHaveBeenCalled();
  });

  it("PATCH name change calls taxonomyEdge.findMany to walk descendants", async () => {
    const updated = { ...baseNode, name: "Renamed" };
    vi.mocked(db.taxonomyNode.findUnique).mockResolvedValue(baseNode as never);
    vi.mocked(db.taxonomyNode.update).mockResolvedValue(updated as never);

    await patch(`/workspaces/${WS_ID}/taxonomy-nodes/${NODE_ID}`, { name: "Renamed" });

    expect(vi.mocked(db.taxonomyEdge.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: WS_ID } })
    );
  });

  it("PATCH name change calls updateMany to null embeddings on descendants", async () => {
    const CHILD_ID = "node-2";
    const updated = { ...baseNode, name: "Renamed" };
    vi.mocked(db.taxonomyNode.findUnique).mockResolvedValue(baseNode as never);
    vi.mocked(db.taxonomyNode.update).mockResolvedValue(updated as never);
    // Simulate one descendant edge
    vi.mocked(db.taxonomyEdge.findMany).mockResolvedValue([
      { id: "e1", sourceNodeId: NODE_ID, targetNodeId: CHILD_ID },
    ] as never);

    await patch(`/workspaces/${WS_ID}/taxonomy-nodes/${NODE_ID}`, { name: "Renamed" });

    expect(vi.mocked(db.taxonomyNode.updateMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: [CHILD_ID] } },
        data: expect.objectContaining({ embeddingTextHash: null }),
      })
    );
  });

  it("PATCH name change with no descendants does not call updateMany", async () => {
    const updated = { ...baseNode, name: "Renamed" };
    vi.mocked(db.taxonomyNode.findUnique).mockResolvedValue(baseNode as never);
    vi.mocked(db.taxonomyNode.update).mockResolvedValue(updated as never);
    // Default: no edges → no descendants

    await patch(`/workspaces/${WS_ID}/taxonomy-nodes/${NODE_ID}`, { name: "Renamed" });

    expect(vi.mocked(db.taxonomyNode.updateMany)).not.toHaveBeenCalled();
  });

  it("PATCH instructions change does not include embedding invalidation", async () => {
    const updated = { ...baseNode, instructions: "Sort by sender domain first" };
    vi.mocked(db.taxonomyNode.findUnique).mockResolvedValue(baseNode as never);
    vi.mocked(db.taxonomyNode.update).mockResolvedValue(updated as never);

    const res = await patch(
      `/workspaces/${WS_ID}/taxonomy-nodes/${NODE_ID}`,
      { instructions: "Sort by sender domain first" }
    );
    expect(res.status).toBe(200);

    // No embedding invalidation for instructions-only change
    expect(vi.mocked(db.taxonomyEdge.findMany)).not.toHaveBeenCalled();
    expect(vi.mocked(db.taxonomyNode.updateMany)).not.toHaveBeenCalled();
    const [callArg] = vi.mocked(db.taxonomyNode.update).mock.calls;
    expect(callArg![0]).not.toMatchObject({ data: { embeddingTextHash: null } });
  });

  it("PATCH positionX change does not include embedding invalidation", async () => {
    const updated = { ...baseNode, positionX: 100 };
    vi.mocked(db.taxonomyNode.findUnique).mockResolvedValue(baseNode as never);
    vi.mocked(db.taxonomyNode.update).mockResolvedValue(updated as never);

    const res = await patch(
      `/workspaces/${WS_ID}/taxonomy-nodes/${NODE_ID}`,
      { positionX: 100 }
    );
    expect(res.status).toBe(200);
    expect(vi.mocked(db.taxonomyEdge.findMany)).not.toHaveBeenCalled();
    const [callArg] = vi.mocked(db.taxonomyNode.update).mock.calls;
    expect(callArg![0]).not.toMatchObject({ data: { embeddingTextHash: null } });
  });

  it("PATCH position-only change does NOT bump taxonomyChangedAt", async () => {
    vi.mocked(db.taxonomyNode.findUnique).mockResolvedValue(baseNode as never);
    vi.mocked(db.taxonomyNode.update).mockResolvedValue({ ...baseNode, positionX: 100 } as never);

    await patch(`/workspaces/${WS_ID}/taxonomy-nodes/${NODE_ID}`, { positionX: 100 });
    expect(vi.mocked(db.workspace.update)).not.toHaveBeenCalled();
  });

  it("PATCH name change bumps taxonomyChangedAt", async () => {
    vi.mocked(db.taxonomyNode.findUnique).mockResolvedValue(baseNode as never);
    vi.mocked(db.taxonomyNode.update).mockResolvedValue({ ...baseNode, name: "Renamed" } as never);
    vi.mocked(db.taxonomyEdge.findMany).mockResolvedValue([] as never);

    await patch(`/workspaces/${WS_ID}/taxonomy-nodes/${NODE_ID}`, { name: "Renamed" });
    expect(vi.mocked(db.workspace.update)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: WS_ID },
        data: expect.objectContaining({ taxonomyChangedAt: expect.any(Date) }),
      })
    );
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
    // Removing a folder changes routing → bump taxonomyChangedAt.
    expect(vi.mocked(db.workspace.update)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: WS_ID },
        data: expect.objectContaining({ taxonomyChangedAt: expect.any(Date) }),
      })
    );
  });

  it("returns 422 when node is the root Inbox node", async () => {
    vi.mocked(db.taxonomyNode.findUnique).mockResolvedValue(
      { ...baseNode, isRoot: true, _count: { outgoingEdges: 0, incomingEdges: 0, classifications: 0 } } as never
    );

    const res = await del(`/workspaces/${WS_ID}/taxonomy-nodes/${NODE_ID}`);
    expect(res.status).toBe(422);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/inbox/i);
  });

  it("returns 422 when node is the catch-all folder", async () => {
    vi.mocked(db.taxonomyNode.findUnique).mockResolvedValue(
      { ...baseNode, isCatchAll: true, _count: { outgoingEdges: 0, incomingEdges: 1, classifications: 0 } } as never
    );

    const res = await del(`/workspaces/${WS_ID}/taxonomy-nodes/${NODE_ID}`);
    expect(res.status).toBe(422);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/catch-all/i);
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

  it("deletes incoming edges along with the node", async () => {
    vi.mocked(db.taxonomyNode.findUnique).mockResolvedValue(
      { ...baseNode, _count: { outgoingEdges: 0, incomingEdges: 1, classifications: 0 } } as never
    );
    vi.mocked(db.taxonomyEdge.deleteMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(db.taxonomyNode.delete).mockResolvedValue(baseNode as never);

    const res = await del(`/workspaces/${WS_ID}/taxonomy-nodes/${NODE_ID}`);
    expect(res.status).toBe(200);
    expect(vi.mocked(db.taxonomyEdge.deleteMany)).toHaveBeenCalledWith({
      where: { targetNodeId: NODE_ID },
    });
  });

  it("deletes node with classifications, unsorts threads when no moveToNodeId given", async () => {
    vi.mocked(db.taxonomyNode.findUnique).mockResolvedValue(
      { ...baseNode, _count: { outgoingEdges: 0, incomingEdges: 0, classifications: 3 } } as never
    );
    vi.mocked(db.emailClassification.updateMany).mockResolvedValue({ count: 3 } as never);
    vi.mocked(db.taxonomyNode.delete).mockResolvedValue(baseNode as never);

    const res = await del(`/workspaces/${WS_ID}/taxonomy-nodes/${NODE_ID}`);
    expect(res.status).toBe(200);
    expect(vi.mocked(db.emailClassification.updateMany)).toHaveBeenCalledWith({
      where: { finalNodeId: NODE_ID },
      data: { finalNodeId: null },
    });
  });

  it("deletes node with classifications, moves threads to target node", async () => {
    const TARGET_NODE_ID = "node-2";
    vi.mocked(db.taxonomyNode.findUnique)
      .mockResolvedValueOnce(
        { ...baseNode, _count: { outgoingEdges: 0, incomingEdges: 0, classifications: 3 } } as never
      )
      .mockResolvedValueOnce(
        { id: TARGET_NODE_ID, workspaceId: WS_ID } as never
      );
    vi.mocked(db.emailClassification.updateMany).mockResolvedValue({ count: 3 } as never);
    vi.mocked(db.taxonomyNode.delete).mockResolvedValue(baseNode as never);

    const res = await delWithBody(`/workspaces/${WS_ID}/taxonomy-nodes/${NODE_ID}`, { moveToNodeId: TARGET_NODE_ID });
    expect(res.status).toBe(200);
    expect(vi.mocked(db.emailClassification.updateMany)).toHaveBeenCalledWith({
      where: { finalNodeId: NODE_ID },
      data: { finalNodeId: TARGET_NODE_ID },
    });
  });

  it("returns 422 when moveToNodeId does not exist", async () => {
    vi.mocked(db.taxonomyNode.findUnique)
      .mockResolvedValueOnce(
        { ...baseNode, _count: { outgoingEdges: 0, incomingEdges: 0, classifications: 1 } } as never
      )
      .mockResolvedValueOnce(null);

    const res = await delWithBody(`/workspaces/${WS_ID}/taxonomy-nodes/${NODE_ID}`, { moveToNodeId: "nonexistent" });
    expect(res.status).toBe(422);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/target node/i);
  });

  it("returns 422 when moveToNodeId belongs to a different workspace", async () => {
    vi.mocked(db.taxonomyNode.findUnique)
      .mockResolvedValueOnce(
        { ...baseNode, _count: { outgoingEdges: 0, incomingEdges: 0, classifications: 1 } } as never
      )
      .mockResolvedValueOnce(
        { id: "node-2", workspaceId: "other-ws" } as never
      );

    const res = await delWithBody(`/workspaces/${WS_ID}/taxonomy-nodes/${NODE_ID}`, { moveToNodeId: "node-2" });
    expect(res.status).toBe(422);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/target node/i);
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

// ─── Authorization (mount-level requireTaxonomyEditor) ─────────────────────────

describe("taxonomy-node writes require an editor", () => {
  // A non-editor MEMBER: passes membership (so not 404) but the editor guard 403s.
  function asNonEditorMember() {
    vi.mocked(db.workspaceMember.findUnique).mockResolvedValue({
      userId: "test-user-1",
      role: "MEMBER",
    } as never);
    vi.mocked(db.workspace.findUnique).mockResolvedValue({
      membersCanEditTaxonomy: false,
    } as never);
  }

  it("403s POST for a MEMBER when membersCanEditTaxonomy is false, and creates nothing", async () => {
    asNonEditorMember();
    const res = await post(`/workspaces/${WS_ID}/taxonomy-nodes`, {
      name: "Clients",
      description: VALID_DESCRIPTION,
    });
    expect(res.status).toBe(403);
    expect(vi.mocked(db.taxonomyNode.create)).not.toHaveBeenCalled();
  });

  it("403s PATCH for a non-editor MEMBER, and updates nothing", async () => {
    asNonEditorMember();
    const res = await patch(`/workspaces/${WS_ID}/taxonomy-nodes/${NODE_ID}`, { name: "Renamed" });
    expect(res.status).toBe(403);
    expect(vi.mocked(db.taxonomyNode.update)).not.toHaveBeenCalled();
  });

  it("403s DELETE for a non-editor MEMBER, and deletes nothing", async () => {
    asNonEditorMember();
    const res = await del(`/workspaces/${WS_ID}/taxonomy-nodes/${NODE_ID}`);
    expect(res.status).toBe(403);
    expect(vi.mocked(db.taxonomyNode.delete)).not.toHaveBeenCalled();
  });

  it("lets a MEMBER through when membersCanEditTaxonomy is true (not 403)", async () => {
    vi.mocked(db.workspaceMember.findUnique).mockResolvedValue({
      userId: "test-user-1",
      role: "MEMBER",
    } as never);
    // isTaxonomyEditor reads this; the create handler reads workspace existence.
    vi.mocked(db.workspace.findUnique).mockResolvedValue({
      id: WS_ID,
      membersCanEditTaxonomy: true,
    } as never);
    vi.mocked(db.taxonomyNode.create).mockResolvedValue({
      ...baseNode,
      name: "Clients",
      description: VALID_DESCRIPTION,
    } as never);

    const res = await post(`/workspaces/${WS_ID}/taxonomy-nodes`, {
      name: "Clients",
      description: VALID_DESCRIPTION,
    });
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(201);
  });
});
