import { vi, describe, it, expect, beforeEach } from "vitest";
import { authed } from "./helpers.js";

vi.mock("@aziru/config", () => ({
  config: {
    redis: { url: "redis://localhost:6379" },
    billing: { enforceThreadSortQuota: false },
    internalApiSecret: "dev-internal-secret",
  },
}));

vi.mock("@aziru/db", () => ({
  Prisma: {},
  db: {
    workspace: { findUnique: vi.fn() },
    workspaceMember: { findUnique: vi.fn() },
    taxonomyNode: { findMany: vi.fn() },
    taxonomyEdge: { findMany: vi.fn() },
    emailThread: { findMany: vi.fn(), updateMany: vi.fn() },
    emailConnection: { findUnique: vi.fn() },
    gmailSyncSettings: { findUnique: vi.fn() },
    emailAccount: { findUnique: vi.fn() },
    providerSyncState: { updateMany: vi.fn() },
  },
}));

vi.mock("../queues.js", () => ({
  classifyThreadQueue: { addBulk: vi.fn().mockResolvedValue([]) },
}));

vi.mock("../services/queue-client.js", () => ({
  backfillInboxQueue: { add: vi.fn() },
}));

import app from "../app.js";
import { db } from "@aziru/db";
import { classifyThreadQueue } from "../queues.js";
import { TAXONOMY_MIN_NON_ROOT_NODES } from "@aziru/shared";
import {
  DEDUP_CLASSIFY_UNROUTED,
  DEDUP_CLASSIFY_UNCLASSIFIED,
  DEDUP_CLASSIFY_NEEDS_REVIEW,
} from "@aziru/queue";

const WS_ID = "ws-1";
const ROOT_NODE_ID = "root-id";

function post(path: string) {
  return app.request(path, authed({ method: "POST" }));
}

function get(path: string) {
  return app.request(path, authed({ method: "GET" }));
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
  vi.mocked(db.workspace.findUnique).mockResolvedValue({ taxonomyChangedAt: null } as never);
  vi.mocked(classifyThreadQueue.addBulk).mockResolvedValue([]);
  vi.mocked(db.emailThread.updateMany).mockResolvedValue({ count: 0 } as never);
  vi.mocked(db.gmailSyncSettings.findUnique).mockResolvedValue({
    includeSpam: false,
    includePromotions: false,
  } as never);
  vi.mocked(db.emailConnection.findUnique).mockResolvedValue({
    status: "ACTIVE",
    emailAddress: "user@example.com",
    subjectId: "sub-1",
  } as never);
  vi.mocked(db.emailAccount.findUnique).mockResolvedValue({ id: "acct-1" } as never);
  // Default: a backfill is still in flight, so arming updates one row.
  vi.mocked(db.providerSyncState.updateMany).mockResolvedValue({ count: 1 } as never);
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

  it("returns 200 with queued:0 when taxonomy is strong but no waiting threads exist", async () => {
    vi.mocked(db.emailThread.findMany).mockResolvedValue([] as never);

    const res = await post(`/workspaces/${WS_ID}/sorting-queue/route-unrouted`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.queued).toBe(0);
    expect(classifyThreadQueue.addBulk).not.toHaveBeenCalled();
  });

  it("routes the waiting set (PENDING + UNROUTED, inbox-visible) to PENDING and enqueues jobs", async () => {
    vi.mocked(db.emailThread.findMany).mockResolvedValue([
      { id: "t1" },
      { id: "t2" },
    ] as never);

    const res = await post(`/workspaces/${WS_ID}/sorting-queue/route-unrouted`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.queued).toBe(2);

    // Targets both PENDING (waiting) and legacy UNROUTED threads, excluding trash.
    expect(db.emailThread.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          triageStatus: { in: ["PENDING", "UNROUTED"] },
          classifyingAt: null,
          gmailIsTrash: false,
        }),
      })
    );

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

  it("first start stamps the live/backfill boundary and routes as BACKFILL", async () => {
    vi.mocked(db.emailThread.findMany).mockResolvedValue([{ id: "t1" }] as never);
    // The boundary update writes one row → this is a first start.
    vi.mocked(db.providerSyncState.updateMany).mockResolvedValue({ count: 1 } as never);

    const res = await post(`/workspaces/${WS_ID}/sorting-queue/route-unrouted`);
    expect(res.status).toBe(200);

    // The boundary is stamped exactly once, guarded on it still being null.
    expect(db.providerSyncState.updateMany).toHaveBeenCalledWith({
      where: { emailAccountId: "acct-1", backfillRoutingStartedAt: null },
      data: { backfillRoutingStartedAt: expect.any(Date) },
    });

    // The initial sweep is the quota-exempt BACKFILL allowance.
    const [jobs] = vi.mocked(classifyThreadQueue.addBulk).mock.calls[0]!;
    for (const job of jobs) {
      expect((job.data as { source?: string }).source).toBe("BACKFILL");
    }
  });

  it("routes as REROUTE once backfill routing has already been started", async () => {
    vi.mocked(db.emailThread.findMany).mockResolvedValue([{ id: "t1" }] as never);
    // Boundary already set → the guarded update writes zero rows (not a first
    // start); the arm update still writes one. Branch on the where clause.
    vi.mocked(db.providerSyncState.updateMany).mockImplementation((args: unknown) => {
      const where = (args as { where?: { backfillRoutingStartedAt?: unknown } }).where;
      const count = where && "backfillRoutingStartedAt" in where ? 0 : 1;
      return Promise.resolve({ count }) as never;
    });

    const res = await post(`/workspaces/${WS_ID}/sorting-queue/route-unrouted`);
    expect(res.status).toBe(200);

    const [jobs] = vi.mocked(classifyThreadQueue.addBulk).mock.calls[0]!;
    for (const job of jobs) {
      expect((job.data as { source?: string }).source).toBe("REROUTE");
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

  it("arms autoRouteBacklog only for in-flight backfills (backfillStatus != DONE)", async () => {
    vi.mocked(db.emailThread.findMany).mockResolvedValue([{ id: "t1" }] as never);

    const res = await post(`/workspaces/${WS_ID}/sorting-queue/route-unrouted`);
    expect(res.status).toBe(200);

    // The DONE filter is applied in the query, so an already-finished backfill is
    // never armed; the handler unconditionally issues the guarded update.
    expect(db.providerSyncState.updateMany).toHaveBeenCalledWith({
      where: { emailAccountId: "acct-1", backfillStatus: { not: "DONE" } },
      data: { autoRouteBacklogArmed: true },
    });
  });

  it("does not arm when the workspace has no email account yet", async () => {
    vi.mocked(db.emailAccount.findUnique).mockResolvedValue(null as never);
    vi.mocked(db.emailThread.findMany).mockResolvedValue([{ id: "t1" }] as never);

    const res = await post(`/workspaces/${WS_ID}/sorting-queue/route-unrouted`);
    expect(res.status).toBe(200);
    expect(db.providerSyncState.updateMany).not.toHaveBeenCalled();
  });

  it("does not arm when there is no Gmail connection", async () => {
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue(null as never);
    vi.mocked(db.emailThread.findMany).mockResolvedValue([{ id: "t1" }] as never);

    const res = await post(`/workspaces/${WS_ID}/sorting-queue/route-unrouted`);
    expect(res.status).toBe(200);
    expect(db.emailAccount.findUnique).not.toHaveBeenCalled();
    expect(db.providerSyncState.updateMany).not.toHaveBeenCalled();
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

// ─── reroute-needs-review ─────────────────────────────────────────────────────

type ReviewThread = {
  id: string;
  classifications: { createdAt: Date; transientFailure: boolean; decisionSource: string | null }[];
};

/**
 * Wire the shared emailThread.findMany mock for the two-step needs-review flow:
 * the eligibility query (select includes `classifications`) returns `threads`;
 * the subsequent enqueue query (select is `{ id: true }`) returns only the ids
 * the route passed through, so the assertions reflect the eligibility filter.
 */
function mockNeedsReview(threads: ReviewThread[]) {
  vi.mocked(db.emailThread.findMany).mockImplementation((args: unknown) => {
    const select = (args as { select?: Record<string, unknown> }).select ?? {};
    if ("classifications" in select) return Promise.resolve(threads) as never;
    // Enqueue query: honor the id filter the route computed.
    const where = (args as { where?: { id?: { in?: string[] } } }).where;
    const ids = where?.id?.in ?? threads.map((t) => t.id);
    return Promise.resolve(ids.map((id) => ({ id }))) as never;
  });
}

function reviewRow(id: string, latest: ReviewThread["classifications"][number] | null): ReviewThread {
  return { id, classifications: latest ? [latest] : [] };
}

describe("reroute-needs-review", () => {
  const CHANGED_AT = new Date("2026-02-01T00:00:00Z");
  const BEFORE = new Date("2026-01-01T00:00:00Z");
  const AFTER = new Date("2026-03-01T00:00:00Z");

  it("GET returns the eligible count", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({ taxonomyChangedAt: CHANGED_AT } as never);
    mockNeedsReview([
      reviewRow("stale", { createdAt: BEFORE, transientFailure: false, decisionSource: "inbox_fallback" }),
      reviewRow("fresh", { createdAt: AFTER, transientFailure: false, decisionSource: "inbox_fallback" }),
      reviewRow("transient", { createdAt: AFTER, transientFailure: true, decisionSource: "inbox_fallback" }),
    ]);

    const res = await get(`/workspaces/${WS_ID}/sorting-queue/reroute-needs-review`);
    expect(res.status).toBe(200);
    // stale (predates change) + transient (fail-open) are eligible; fresh is not.
    expect((await res.json() as Record<string, unknown>).eligible).toBe(2);
  });

  it("excludes empty-text (no_text_content) threads even after a taxonomy change", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({ taxonomyChangedAt: CHANGED_AT } as never);
    mockNeedsReview([
      reviewRow("empty", { createdAt: BEFORE, transientFailure: false, decisionSource: "no_text_content" }),
    ]);

    const res = await get(`/workspaces/${WS_ID}/sorting-queue/reroute-needs-review`);
    expect((await res.json() as Record<string, unknown>).eligible).toBe(0);
  });

  it("with no taxonomy change, only transient-failure threads are eligible", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({ taxonomyChangedAt: null } as never);
    mockNeedsReview([
      reviewRow("stale", { createdAt: BEFORE, transientFailure: false, decisionSource: "inbox_fallback" }),
      reviewRow("transient", { createdAt: BEFORE, transientFailure: true, decisionSource: "inbox_fallback" }),
    ]);

    const res = await get(`/workspaces/${WS_ID}/sorting-queue/reroute-needs-review`);
    expect((await res.json() as Record<string, unknown>).eligible).toBe(1);
  });

  it("POST enqueues only eligible threads as REROUTE with the needs-review dedup prefix", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({ taxonomyChangedAt: CHANGED_AT } as never);
    mockNeedsReview([
      reviewRow("stale", { createdAt: BEFORE, transientFailure: false, decisionSource: "inbox_fallback" }),
      reviewRow("fresh", { createdAt: AFTER, transientFailure: false, decisionSource: "inbox_fallback" }),
    ]);

    const res = await post(`/workspaces/${WS_ID}/sorting-queue/reroute-needs-review`);
    expect(res.status).toBe(200);
    expect((await res.json() as Record<string, unknown>).queued).toBe(1);

    const [jobs] = vi.mocked(classifyThreadQueue.addBulk).mock.calls[0]!;
    expect(jobs).toHaveLength(1);
    expect((jobs[0]!.data as { source?: string }).source).toBe("REROUTE");
    expect(jobs[0]!.opts?.deduplication?.id).toMatch(new RegExp(`^${DEDUP_CLASSIFY_NEEDS_REVIEW}_`));
  });

  it("POST returns queued:0 and enqueues nothing when none are eligible", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({ taxonomyChangedAt: null } as never);
    mockNeedsReview([
      reviewRow("fresh", { createdAt: AFTER, transientFailure: false, decisionSource: "inbox_fallback" }),
    ]);

    const res = await post(`/workspaces/${WS_ID}/sorting-queue/reroute-needs-review`);
    expect(res.status).toBe(200);
    expect((await res.json() as Record<string, unknown>).queued).toBe(0);
    expect(classifyThreadQueue.addBulk).not.toHaveBeenCalled();
  });
});

