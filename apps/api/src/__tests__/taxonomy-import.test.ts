import { vi, describe, it, expect, beforeEach } from "vitest";
import { authed } from "./helpers.js";

vi.mock("@amarnai/db", () => ({
  db: {
    workspaceMember: {
      findUnique: vi.fn(),
    },
    taxonomyNode: {
      findFirst: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    taxonomyEdge: {
      deleteMany: vi.fn(),
      create: vi.fn(),
    },
    emailClassification: {
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import app from "../app.js";
import { db } from "@amarnai/db";

const WS_ID = "ws-1";
const ROOT_ID = "existing-root-id";
const VALID_DESCRIPTION = "A valid description for testing purposes with length";

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return app.request(
    path,
    authed({
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    })
  );
}

function validFile() {
  return {
    amarnaiTaxonomyVersion: 1,
    exportedAt: "2026-06-14T12:00:00.000Z",
    nodes: [
      {
        ref: "root",
        name: "Inbox",
        description: null,
        instructions: null,
        draftPrompt: null,
        examples: [],
        isRoot: true,
        positionX: 0,
        positionY: 0,
      },
      {
        ref: "n1",
        name: "Invoices",
        description: VALID_DESCRIPTION,
        instructions: null,
        draftPrompt: null,
        examples: [],
        isRoot: false,
        positionX: 100,
        positionY: 80,
      },
    ],
    edges: [{ sourceRef: "root", targetRef: "n1" }],
  };
}

const IMPORT_PATH = `/workspaces/${WS_ID}/taxonomy-import`;

describe("POST /workspaces/:workspaceId/taxonomy-import", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.workspaceMember.findUnique).mockResolvedValue({
      userId: "test-user-1",
    } as never);
    vi.mocked(db.taxonomyNode.findFirst).mockResolvedValue({
      id: ROOT_ID,
    } as never);
    vi.mocked(db.$transaction).mockImplementation(async (fn) => fn(db as never));
    vi.mocked(db.taxonomyEdge.deleteMany).mockResolvedValue({ count: 0 } as never);
    vi.mocked(db.emailClassification.updateMany).mockResolvedValue({ count: 0 } as never);
    vi.mocked(db.taxonomyNode.deleteMany).mockResolvedValue({ count: 0 } as never);
    vi.mocked(db.taxonomyNode.update).mockResolvedValue({} as never);
    vi.mocked(db.taxonomyNode.create).mockResolvedValue({ id: "new-node-id" } as never);
    vi.mocked(db.taxonomyEdge.create).mockResolvedValue({} as never);
  });

  it("returns 404 when not a workspace member", async () => {
    vi.mocked(db.workspaceMember.findUnique).mockResolvedValue(null);
    const res = await post(IMPORT_PATH, validFile());
    expect(res.status).toBe(404);
  });

  it("returns 400 on invalid JSON body", async () => {
    const res = await app.request(
      IMPORT_PATH,
      authed({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not-json",
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/Invalid JSON/);
  });

  it("returns 400 when amarnaiTaxonomyVersion is wrong", async () => {
    const res = await post(IMPORT_PATH, { ...validFile(), amarnaiTaxonomyVersion: 2 });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("Invalid taxonomy file");
  });

  it("returns 400 when structural validation fails (cycle)", async () => {
    const file = validFile();
    // Add a back-edge to create a cycle
    file.edges.push({ sourceRef: "n1", targetRef: "root" });
    const res = await post(IMPORT_PATH, file);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/root folder cannot be the target|cycle/);
  });

  it("returns 413 when Content-Length exceeds 1 MB", async () => {
    const res = await post(IMPORT_PATH, validFile(), {
      "content-length": String(1_000_001),
    });
    expect(res.status).toBe(413);
  });

  it("returns 422 when workspace has no root node", async () => {
    vi.mocked(db.taxonomyNode.findFirst).mockResolvedValue(null);
    const res = await post(IMPORT_PATH, validFile());
    expect(res.status).toBe(422);
  });

  it("happy path: runs transaction and returns 200 with counts", async () => {
    const res = await post(IMPORT_PATH, validFile());
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; nodeCount: number; edgeCount: number };
    expect(body.ok).toBe(true);
    expect(body.nodeCount).toBe(2);
    expect(body.edgeCount).toBe(1);
  });

  it("happy path: deletes existing edges before nodes", async () => {
    await post(IMPORT_PATH, validFile());
    const edgeDeleteCall = vi.mocked(db.taxonomyEdge.deleteMany).mock.calls[0];
    expect(edgeDeleteCall?.[0]).toMatchObject({ where: { workspaceId: WS_ID } });
  });

  it("happy path: clears classification finalNodeId", async () => {
    await post(IMPORT_PATH, validFile());
    const classCall = vi.mocked(db.emailClassification.updateMany).mock.calls[0];
    expect(classCall?.[0]).toMatchObject({
      where: { workspaceId: WS_ID, finalNodeId: { not: null } },
      data: { finalNodeId: null },
    });
  });

  it("happy path: deletes non-root nodes", async () => {
    await post(IMPORT_PATH, validFile());
    const nodeDeleteCall = vi.mocked(db.taxonomyNode.deleteMany).mock.calls[0];
    expect(nodeDeleteCall?.[0]).toMatchObject({
      where: { workspaceId: WS_ID, isRoot: false },
    });
  });

  it("happy path: updates root node with name and position from file", async () => {
    await post(IMPORT_PATH, validFile());
    const updateCall = vi.mocked(db.taxonomyNode.update).mock.calls[0];
    expect(updateCall?.[0]).toMatchObject({
      where: { id: ROOT_ID },
      data: expect.objectContaining({ name: "Inbox" }),
    });
  });

  it("happy path: creates non-root nodes with explicit fields (no spread)", async () => {
    await post(IMPORT_PATH, validFile());
    const createCall = vi.mocked(db.taxonomyNode.create).mock.calls[0];
    expect(createCall?.[0]?.data).toMatchObject({
      workspaceId: WS_ID,
      isRoot: false,
      name: "Invoices",
      description: VALID_DESCRIPTION,
    });
    // Verify no stray fields from the file object leak through
    expect(createCall?.[0]?.data).not.toHaveProperty("ref");
  });

  it("happy path: creates edges using remapped node ids", async () => {
    await post(IMPORT_PATH, validFile());
    const createCall = vi.mocked(db.taxonomyEdge.create).mock.calls[0];
    expect(createCall?.[0]?.data).toMatchObject({
      workspaceId: WS_ID,
      sourceNodeId: ROOT_ID,
      targetNodeId: "new-node-id",
    });
  });
});
