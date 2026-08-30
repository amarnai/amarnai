import { vi, describe, it, expect, beforeEach } from "vitest";
import { authed, TEST_USER_ID } from "./helpers.js";

// The colorKey column is display-only; a PATCH that only touches it must
// persist and echo it back without any embedding invalidation.
vi.mock("@aziru/db", () => ({
  db: {
    workspaceMember: { findUnique: vi.fn() },
    workspace: { findUnique: vi.fn() },
    taxonomyNode: { findUnique: vi.fn(), update: vi.fn() },
    taxonomyEdge: { findMany: vi.fn() },
  },
}));

import app from "../app.js";
import { db } from "@aziru/db";

const WORKSPACE_ID = "ws-1";
const NODE_ID = "node-1";

// The serialized node shape the update returns (mirrors nodeSelect). `colorKey`
// echoes whatever the update wrote so the assertions read the persisted value.
function serializedNode(colorKey: string | null) {
  return {
    id: NODE_ID,
    workspaceId: WORKSPACE_ID,
    name: "Invoices",
    description: "Billing and receipts from vendors and clients over time.",
    instructions: null,
    draftPrompt: null,
    examples: [],
    isRoot: false,
    isCatchAll: false,
    colorKey,
    positionX: 0,
    positionY: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Membership + taxonomy-editor guards both read workspaceMember; an OWNER row
  // clears both. isTaxonomyEditor also reads the workspace flag.
  vi.mocked(db.workspaceMember.findUnique).mockResolvedValue({
    userId: TEST_USER_ID,
    role: "OWNER",
  } as never);
  vi.mocked(db.workspace.findUnique).mockResolvedValue({
    membersCanEditTaxonomy: true,
  } as never);
  vi.mocked(db.taxonomyNode.findUnique).mockResolvedValue({
    id: NODE_ID,
    workspaceId: WORKSPACE_ID,
    isRoot: false,
  } as never);
});

function patch(body: unknown) {
  return app.request(
    `/workspaces/${WORKSPACE_ID}/taxonomy-nodes/${NODE_ID}`,
    authed({
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("PATCH taxonomy-node colorKey — serialization", () => {
  it("persists a colorKey and returns it in the serialized node", async () => {
    vi.mocked(db.taxonomyNode.update).mockResolvedValue(
      serializedNode("blue") as never,
    );

    const res = await patch({ colorKey: "blue" });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { colorKey: string | null };
    expect(json.colorKey).toBe("blue");

    // The write persisted colorKey and did NOT invalidate the embedding cache
    // (color feeds no embedding text).
    const arg = vi.mocked(db.taxonomyNode.update).mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(arg.data.colorKey).toBe("blue");
    expect(arg.data).not.toHaveProperty("embeddingTextHash");
  });

  it("clears the override when colorKey is null", async () => {
    vi.mocked(db.taxonomyNode.update).mockResolvedValue(
      serializedNode(null) as never,
    );

    const res = await patch({ colorKey: null });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { colorKey: string | null };
    expect(json.colorKey).toBeNull();

    const arg = vi.mocked(db.taxonomyNode.update).mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(arg.data.colorKey).toBeNull();
  });

  it("rejects an over-long colorKey without writing", async () => {
    const res = await patch({ colorKey: "x".repeat(33) });
    expect(res.status).toBe(400);
    expect(db.taxonomyNode.update).not.toHaveBeenCalled();
  });
});
