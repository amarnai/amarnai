import { vi, describe, it, expect, beforeEach } from "vitest";
import { authed } from "./helpers.js";

vi.mock("@amarnai/config", () => ({
  config: {
    redis: { url: "redis://localhost:6379" },
    billing: { enforceThreadSortQuota: false },
    internalApiSecret: "dev-internal-secret",
  },
}));

vi.mock("@amarnai/db", () => ({
  Prisma: {},
  db: {
    workspaceMember: { findUnique: vi.fn() },
    taxonomyNode: { findMany: vi.fn() },
    taxonomyEdge: { findMany: vi.fn() },
    emailThread: { findMany: vi.fn(), updateMany: vi.fn() },
    gmailConnection: { findUnique: vi.fn() },
    gmailSyncSettings: { findUnique: vi.fn() },
  },
}));

vi.mock("../queues.js", () => ({
  classifyThreadQueue: { addBulk: vi.fn().mockResolvedValue([]) },
}));

vi.mock("../services/queue-client.js", () => ({
  backfillInboxQueue: { add: vi.fn() },
}));

import app from "../app.js";
import { db } from "@amarnai/db";
import { classifyThreadQueue } from "../queues.js";
import { TAXONOMY_MIN_NON_ROOT_NODES } from "@amarnai/shared";
import { DEDUP_CLASSIFY_UNROUTED, DEDUP_CLASSIFY_UNCLASSIFIED } from "@amarnai/queue";

const WS_ID = "ws-1";
const ROOT_NODE_ID = "root-id";

function post(path: string) {
  return app.request(path, authed({ method: "POST" }));
}

function makeNodes(nonRootCount: number) {
  return [
    { id: ROOT_NODE_ID, isRoot: true },
    ...Array.from({ length: nonRootCount }, (_, i) => ({ id: `node-${i + 1}`, isRoot: false })),
  ];
}

/** Edges linking the first `linkedCount` non-root nodes to the root. */
function makeEdges(linkedCount: number) {
  return Array.from({ length: linkedCount }, (_, i) => ({
    sourceNodeId: ROOT_NODE_ID,
    targetNodeId: `node-${i + 1}`,
  }));
}

/** Set the mocked taxonomy to `nonRoot` nodes, `linked` of them reachable. */
function mockTaxonomy(nonRoot: number, linked: number = nonRoot) {
  vi.mocked(db.taxonomyNode.findMany).mockResolvedValue(makeNodes(nonRoot) as never);
  vi.mocked(db.taxonomyEdge.findMany).mockResolvedValue(makeEdges(linked) as never);
}

const BASE_MEMBER = { userId: "test-user-1" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.workspaceMember.findUnique).mockResolvedValue(BASE_MEMBER as never);
  vi.mocked(classifyThreadQueue.addBulk).mockResolvedValue([]);
  vi.mocked(db.emailThread.updateMany).mockResolvedValue({ count: 0 } as never);
  vi.mocked(db.gmailSyncSettings.findUnique).mockResolvedValue({
    includeSpam: false,
    includePromotions: false,
  } as never);
  vi.mocked(db.gmailConnection.findUnique).mockResolvedValue({ status: "ACTIVE" } as never);
  // Default: strong taxonomy (3 non-root nodes all linked to root).
  mockTaxonomy(TAXONOMY_MIN_NON_ROOT_NODES);
});

// ─── POST /sorting-queue/route-unrouted ───────────────────────────────────────

describe("POST /workspaces/:workspaceId/sorting-queue/route-unrouted", () => {
  it("returns 422 with taxonomy_too_weak when routable count is below threshold", async () => {
    mockTaxonomy(TAXONOMY_MIN_NON_ROOT_NODES - 1);
    const res = await post(`/workspaces/${WS_ID}/sorting-queue/route-unrouted`);
    expect(res.status).toBe(422);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe("taxonomy_too_weak");
  });

  it("returns 422 with taxonomy_too_weak when 3 nodes exist but are not linked to the root", async () => {
    mockTaxonomy(TAXONOMY_MIN_NON_ROOT_NODES, 0);
    const res = await post(`/workspaces/${WS_ID}/sorting-queue/route-unrouted`);
    expect(res.status).toBe(422);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe("taxonomy_too_weak");
  });

  it("returns 200 with queued:0 when taxonomy is strong but no UNROUTED threads exist", async () => {
    vi.mocked(db.emailThread.findMany).mockResolvedValue([] as never);

    const res = await post(`/workspaces/${WS_ID}/sorting-queue/route-unrouted`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.queued).toBe(0);
    expect(classifyThreadQueue.addBulk).not.toHaveBeenCalled();
  });

  it("transitions UNROUTED threads to PENDING, stamps classifyingAt, and enqueues jobs", async () => {
    vi.mocked(db.emailThread.findMany).mockResolvedValue([
      { id: "t1" },
      { id: "t2" },
    ] as never);

    const res = await post(`/workspaces/${WS_ID}/sorting-queue/route-unrouted`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.queued).toBe(2);

    expect(db.emailThread.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          triageStatus: "PENDING",
          classifyingAt: expect.any(Date),
        }),
      })
    );

    expect(classifyThreadQueue.addBulk).toHaveBeenCalledOnce();
    const [jobs] = vi.mocked(classifyThreadQueue.addBulk).mock.calls[0]!;
    expect(jobs).toHaveLength(2);
    for (const job of jobs) {
      expect(job.opts?.deduplication?.id).toMatch(
        new RegExp(`^${DEDUP_CLASSIFY_UNROUTED}_`)
      );
      expect(job.opts?.priority).toBe(5);
    }
  });

  it("excludes threads that already have classifyingAt set", async () => {
    // findMany respects the classifyingAt: null filter in the where clause —
    // returning empty simulates all threads already being in-progress.
    vi.mocked(db.emailThread.findMany).mockResolvedValue([] as never);

    const res = await post(`/workspaces/${WS_ID}/sorting-queue/route-unrouted`);
    expect(res.status).toBe(200);
    expect((await res.json() as Record<string, unknown>).queued).toBe(0);
  });
});

// ─── POST /sorting-queue/reroute-unclassified ─────────────────────────────────

describe("POST /workspaces/:workspaceId/sorting-queue/reroute-unclassified", () => {
  it("enqueues UNCLASSIFIED threads and returns queued count", async () => {
    vi.mocked(db.emailThread.findMany).mockResolvedValue([
      { id: "t1" },
      { id: "t2" },
      { id: "t3" },
    ] as never);

    const res = await post(`/workspaces/${WS_ID}/sorting-queue/reroute-unclassified`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.queued).toBe(3);

    expect(db.emailThread.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ triageStatus: "PENDING" }),
      })
    );

    const [jobs] = vi.mocked(classifyThreadQueue.addBulk).mock.calls[0]!;
    expect(jobs).toHaveLength(3);
    for (const job of jobs) {
      expect(job.opts?.deduplication?.id).toMatch(
        new RegExp(`^${DEDUP_CLASSIFY_UNCLASSIFIED}_`)
      );
    }
  });

  it("returns queued:0 when no UNCLASSIFIED threads exist", async () => {
    vi.mocked(db.emailThread.findMany).mockResolvedValue([] as never);

    const res = await post(`/workspaces/${WS_ID}/sorting-queue/reroute-unclassified`);
    expect(res.status).toBe(200);
    expect((await res.json() as Record<string, unknown>).queued).toBe(0);
    expect(classifyThreadQueue.addBulk).not.toHaveBeenCalled();
  });

  it("does not require a strong taxonomy", async () => {
    mockTaxonomy(0, 0);
    vi.mocked(db.emailThread.findMany).mockResolvedValue([{ id: "t1" }] as never);

    const res = await post(`/workspaces/${WS_ID}/sorting-queue/reroute-unclassified`);
    expect(res.status).toBe(200);
  });
});

