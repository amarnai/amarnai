import { vi, describe, it, expect, beforeEach } from "vitest";
import { authed } from "./helpers.js";

vi.mock("@amarnai/db", () => ({
  db: {
    workspaceMember: {
      findUnique: vi.fn(),
    },
    workspace: {
      update: vi.fn(),
    },
    taxonomyNode: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    taxonomyEdge: {
      deleteMany: vi.fn(),
      create: vi.fn(),
    },
    emailThread: {
      updateMany: vi.fn(),
    },
    emailClassification: {
      updateMany: vi.fn(),
      createMany: vi.fn(),
    },
    taxonomyGenerationState: {
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
  Prisma: { DbNull: Symbol("DbNull") },
}));

vi.mock("../queues.js", () => ({
  classifyThreadQueue: { addBulk: vi.fn().mockResolvedValue([]) },
}));

vi.mock("../services/taxonomy-migration.js", () => ({
  latestClassificationsByThread: vi.fn(),
  computeMigrationPreview: vi.fn(),
}));

import app from "../app.js";
import { db } from "@amarnai/db";
import { classifyThreadQueue } from "../queues.js";
import { latestClassificationsByThread } from "../services/taxonomy-migration.js";
import { DEDUP_CLASSIFY_MIGRATION } from "@amarnai/queue";

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
      {
        ref: "other",
        name: "Updates / Other",
        description: "Automated notifications and bulk mail that doesn't fit another folder.",
        instructions: null,
        draftPrompt: null,
        examples: [],
        isRoot: false,
        isCatchAll: true,
        positionX: 100,
        positionY: 160,
      },
    ],
    edges: [
      { sourceRef: "root", targetRef: "n1" },
      { sourceRef: "root", targetRef: "other" },
    ],
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
    vi.mocked(db.emailClassification.createMany).mockResolvedValue({ count: 0 } as never);
    vi.mocked(db.taxonomyNode.deleteMany).mockResolvedValue({ count: 0 } as never);
    // currentNodes lookup: a mapped folder "cur-n1" and the catch-all "cur-other".
    vi.mocked(db.taxonomyNode.findMany).mockResolvedValue([
      { id: "cur-n1", name: "Invoices (old)", isCatchAll: false },
      { id: "cur-other", name: "Updates (old)", isCatchAll: true },
    ] as never);
    vi.mocked(db.taxonomyNode.update).mockResolvedValue({} as never);
    // Distinct node ids so migration rows can be told apart in assertions.
    let created = 0;
    vi.mocked(db.taxonomyNode.create).mockImplementation(
      (() => Promise.resolve({ id: `new-node-${++created}` })) as never,
    );
    vi.mocked(db.taxonomyEdge.create).mockResolvedValue({} as never);
    vi.mocked(db.emailThread.updateMany).mockResolvedValue({ count: 0 } as never);
    vi.mocked(db.workspace.update).mockResolvedValue({} as never);
    vi.mocked(db.taxonomyGenerationState.updateMany).mockResolvedValue({ count: 0 } as never);
    vi.mocked(classifyThreadQueue.addBulk).mockResolvedValue([] as never);
    // Default: no threads exist (pure structural apply).
    vi.mocked(latestClassificationsByThread).mockResolvedValue([]);
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
    expect(body.nodeCount).toBe(3);
    expect(body.edgeCount).toBe(2);
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

  it("happy path: consumes a pending READY generation proposal", async () => {
    await post(IMPORT_PATH, validFile());
    const consumeCall = vi.mocked(db.taxonomyGenerationState.updateMany).mock.calls[0];
    expect(consumeCall?.[0]).toMatchObject({
      where: { workspaceId: WS_ID, status: "READY" },
      data: { status: "IDLE", matchedTemplateId: null },
    });
  });

  it("happy path: creates edges using remapped node ids", async () => {
    await post(IMPORT_PATH, validFile());
    const createCall = vi.mocked(db.taxonomyEdge.create).mock.calls[0];
    expect(createCall?.[0]?.data).toMatchObject({
      workspaceId: WS_ID,
      sourceNodeId: ROOT_ID,
      targetNodeId: expect.stringMatching(/^new-node-/),
    });
  });

  it("bumps taxonomyChangedAt on apply", async () => {
    await post(IMPORT_PATH, validFile());
    expect(db.workspace.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: WS_ID },
        data: expect.objectContaining({ taxonomyChangedAt: expect.any(Date) }),
      })
    );
  });

  // ── Migration mapping ───────────────────────────────────────────────────────

  describe("with folder migration mapping", () => {
    it("migrates mapped folders' threads (MIGRATION rows) and leaves them SORTED", async () => {
      vi.mocked(latestClassificationsByThread).mockResolvedValue([
        { emailThreadId: "t-mapped", finalNodeId: "cur-n1", triageStatus: "SORTED" },
      ]);

      const res = await post(IMPORT_PATH, { file: validFile(), mapping: { "cur-n1": "n1" } });
      expect(res.status).toBe(200);
      const body = await res.json() as { migratedThreads: number; requeuedThreads: number };
      expect(body.migratedThreads).toBe(1);
      expect(body.requeuedThreads).toBe(0);

      const createManyCall = vi.mocked(db.emailClassification.createMany).mock.calls[0];
      const rows = (createManyCall?.[0] as { data: Array<Record<string, unknown>> }).data;
      expect(rows[0]).toMatchObject({
        emailThreadId: "t-mapped",
        source: "MIGRATION",
        decisionSource: "migration",
        needsHumanReview: false,
      });
      // Never flipped to PENDING (stays SORTED).
      expect(db.emailThread.updateMany).not.toHaveBeenCalled();
      // Nothing re-enqueued.
      expect(classifyThreadQueue.addBulk).not.toHaveBeenCalled();
    });

    it("re-sorts SORTED threads under an unmapped folder (orphan-bug fix)", async () => {
      vi.mocked(latestClassificationsByThread).mockResolvedValue([
        { emailThreadId: "t-orphan", finalNodeId: "cur-n1", triageStatus: "SORTED" },
      ]);

      // Empty mapping → cur-n1 is unmapped → its SORTED thread must be re-sorted.
      const res = await post(IMPORT_PATH, { file: validFile(), mapping: {} });
      expect(res.status).toBe(200);
      const body = await res.json() as { migratedThreads: number; requeuedThreads: number };
      expect(body.migratedThreads).toBe(0);
      expect(body.requeuedThreads).toBe(1);

      expect(db.emailThread.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: ["t-orphan"] } },
          data: expect.objectContaining({ triageStatus: "PENDING", classifyingAt: expect.any(Date) }),
        })
      );
      const [jobs] = vi.mocked(classifyThreadQueue.addBulk).mock.calls[0]!;
      expect(jobs).toHaveLength(1);
      expect((jobs[0]!.data as { source?: string }).source).toBe("REROUTE");
      expect(jobs[0]!.opts?.deduplication?.id).toMatch(new RegExp(`^${DEDUP_CLASSIFY_MIGRATION}_`));
    });

    it("re-sorts NEEDS_REVIEW and UNCLASSIFIED threads regardless of mapping", async () => {
      vi.mocked(latestClassificationsByThread).mockResolvedValue([
        { emailThreadId: "t-review", finalNodeId: null, triageStatus: "NEEDS_REVIEW" },
        { emailThreadId: "t-unclass", finalNodeId: ROOT_ID, triageStatus: "UNCLASSIFIED" },
      ]);

      const res = await post(IMPORT_PATH, { file: validFile(), mapping: { "cur-n1": "n1" } });
      const body = await res.json() as { requeuedThreads: number };
      expect(body.requeuedThreads).toBe(2);
    });

    it("rejects a mapping targeting an unknown folder ref", async () => {
      vi.mocked(latestClassificationsByThread).mockResolvedValue([]);
      const res = await post(IMPORT_PATH, { file: validFile(), mapping: { "cur-n1": "does-not-exist" } });
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/unknown folder ref/);
    });

    it("rejects a mapping targeting the root ref", async () => {
      const res = await post(IMPORT_PATH, { file: validFile(), mapping: { "cur-n1": "root" } });
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/root/i);
    });

    it("drops mapping keys for folders deleted since preview", async () => {
      // "ghost" is not in currentNodes → dropped; its (would-be) threads never
      // appear because latest classifications don't reference it.
      vi.mocked(latestClassificationsByThread).mockResolvedValue([]);
      const res = await post(IMPORT_PATH, { file: validFile(), mapping: { ghost: "n1" } });
      expect(res.status).toBe(200);
    });
  });
});
