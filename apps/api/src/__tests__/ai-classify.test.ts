import { vi, describe, it, expect, beforeEach } from "vitest";
import { authed } from "./helpers.js";

const mockBilling = vi.hoisted(() => ({ enforceThreadSortQuota: true }));
const { mockResolveInboxQuota } = vi.hoisted(() => ({ mockResolveInboxQuota: vi.fn() }));

vi.mock("@aziru/config", () => ({
  config: {
    redis: { url: "redis://localhost:6379" },
    billing: mockBilling,
    internalApiSecret: "dev-internal-secret",
  },
}));

vi.mock("@aziru/db", () => ({
  Prisma: {},
  db: {
    emailThread: { findFirst: vi.fn(), update: vi.fn() },
    taxonomyNode: { count: vi.fn(), findMany: vi.fn() },
    taxonomyEdge: { findMany: vi.fn() },
    emailClassification: { create: vi.fn(), findFirst: vi.fn() },
    workspace: { findUnique: vi.fn() },
    workspaceMember: { findUnique: vi.fn() },
    emailConnection: { findUnique: vi.fn() },
    $queryRaw: vi.fn(),
  },
  resolveInboxQuota: mockResolveInboxQuota,
}));

vi.mock("../queues.js", () => ({
  classifyThreadQueue: { add: vi.fn().mockResolvedValue({}) },
}));

import app from "../app.js";
import { db } from "@aziru/db";
import { getThreadSortLimit } from "@aziru/shared";
import { classifyThreadQueue } from "../queues.js";

const FREE_LIMIT = getThreadSortLimit("FREE");

const WS_ID = "ws-1";
const THREAD_ID = "thread-1";

const THREAD = {
  id: THREAD_ID,
  messages: [
    {
      subject: "Hello",
      senderEmail: "client@example.com",
      senderName: "Client",
      bodyText: "Can we talk?",
      receivedAt: new Date(),
    },
  ],
};

function post(path: string) {
  return app.request(path, authed({ method: "POST" }));
}

// A routable taxonomy: root + 3 real folders (>= TAXONOMY_MIN_NON_ROOT_NODES)
// plus the mandatory catch-all (excluded from the routable count).
const NODES = [
  { id: "node-root", name: "Inbox", isRoot: true, isCatchAll: false },
  { id: "node-a", name: "Clients", isRoot: false, isCatchAll: false },
  { id: "node-b", name: "Finance", isRoot: false, isCatchAll: false },
  { id: "node-c", name: "Personal", isRoot: false, isCatchAll: false },
  { id: "node-other", name: "Updates / Other", isRoot: false, isCatchAll: true },
];
const EDGES = [
  { sourceNodeId: "node-root", targetNodeId: "node-a" },
  { sourceNodeId: "node-root", targetNodeId: "node-b" },
  { sourceNodeId: "node-root", targetNodeId: "node-c" },
  { sourceNodeId: "node-root", targetNodeId: "node-other" },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockBilling.enforceThreadSortQuota = true;
  vi.mocked(db.workspaceMember.findUnique).mockResolvedValue({ userId: "test-user-1" } as never);
  vi.mocked(db.taxonomyNode.findMany).mockResolvedValue(NODES as never);
  vi.mocked(db.taxonomyEdge.findMany).mockResolvedValue(EDGES as never);
  vi.mocked(db.emailThread.findFirst).mockResolvedValue(THREAD as never);
  vi.mocked(db.emailThread.update).mockResolvedValue({} as never);
  vi.mocked(db.emailClassification.create).mockResolvedValue({ id: "cls-1" } as never);
  vi.mocked(db.emailClassification.findFirst).mockResolvedValue({ id: "cls-existing" } as never);
  vi.mocked(classifyThreadQueue.add).mockResolvedValue({} as never);
  // Default: active inbox on FREE plan, 0 threads sorted this month (well under the limit).
  vi.mocked(db.emailConnection.findUnique).mockResolvedValue({
    emailAddress: "ben@gmail.com",
    status: "ACTIVE",
  } as never);
  mockResolveInboxQuota.mockResolvedValue({
    inboxKey: "ben@gmail.com",
    windowStart: new Date("2026-06-01T00:00:00Z"),
    plan: "FREE",
    used: 0,
  });
});

// ─── ai-classify ──────────────────────────────────────────────────────────────
//
// ai-classify is now async: it stamps classifyingAt on the thread, enqueues a
// classify-thread BullMQ job, and returns 202 { queued: true } immediately.
// The worker handles the actual AI call, classification persistence, and
// triageStatus update.

describe("POST /workspaces/:workspaceId/email-threads/:threadId/ai-classify", () => {
  it("returns 404 when thread not found", async () => {
    vi.mocked(db.emailThread.findFirst).mockResolvedValue(null);
    const res = await post(`/workspaces/${WS_ID}/email-threads/${THREAD_ID}/ai-classify`);
    expect(res.status).toBe(404);
  });

  it("returns 422 when the taxonomy is not routable (only root + catch-all)", async () => {
    vi.mocked(db.taxonomyNode.findMany).mockResolvedValue([
      { id: "node-root", name: "Inbox", isRoot: true, isCatchAll: false },
      { id: "node-other", name: "Updates / Other", isRoot: false, isCatchAll: true },
    ] as never);
    vi.mocked(db.taxonomyEdge.findMany).mockResolvedValue([
      { sourceNodeId: "node-root", targetNodeId: "node-other" },
    ] as never);
    const res = await post(`/workspaces/${WS_ID}/email-threads/${THREAD_ID}/ai-classify`);
    expect(res.status).toBe(422);
  });

  it("stamps classifyingAt, enqueues a classify-thread job, and returns 202", async () => {
    const res = await post(`/workspaces/${WS_ID}/email-threads/${THREAD_ID}/ai-classify`);

    expect(res.status).toBe(202);
    const body = await res.json() as Record<string, unknown>;
    expect(body.queued).toBe(true);

    // classifyingAt must be set so the UI immediately shows the sorting badge.
    expect(db.emailThread.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: THREAD_ID },
        data: expect.objectContaining({ classifyingAt: expect.any(Date) }),
      })
    );

    // One classify-thread job must be enqueued.
    expect(classifyThreadQueue.add).toHaveBeenCalledOnce();
    expect(classifyThreadQueue.add).toHaveBeenCalledWith(
      "classify-thread",
      { workspaceId: WS_ID, emailThreadId: THREAD_ID, source: "MANUAL" },
      expect.objectContaining({ deduplication: expect.objectContaining({ id: expect.any(String) }) })
    );
  });

  it("does not call the AI or persist a classification (worker handles that)", async () => {
    await post(`/workspaces/${WS_ID}/email-threads/${THREAD_ID}/ai-classify`);
    expect(db.emailClassification.create).not.toHaveBeenCalled();
  });
});

// ─── ai-classify quota enforcement ────────────────────────────────────────────

describe("POST /workspaces/:workspaceId/email-threads/:threadId/ai-classify — quota", () => {
  it("allows the request when usage is below the limit", async () => {
    // All but one FREE-plan slot used — one remaining.
    mockResolveInboxQuota.mockResolvedValue({ inboxKey: "ben@gmail.com", windowStart: new Date(), plan: "FREE", used: FREE_LIMIT - 1 });
    const res = await post(`/workspaces/${WS_ID}/email-threads/${THREAD_ID}/ai-classify`);
    expect(res.status).toBe(202);
    expect(classifyThreadQueue.add).toHaveBeenCalledOnce();
  });

  it("returns 429 with quota details when the monthly limit is reached", async () => {
    // At the FREE limit.
    mockResolveInboxQuota.mockResolvedValue({ inboxKey: "ben@gmail.com", windowStart: new Date(), plan: "FREE", used: FREE_LIMIT });
    const res = await post(`/workspaces/${WS_ID}/email-threads/${THREAD_ID}/ai-classify`);
    expect(res.status).toBe(429);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toMatch(/quota exceeded/i);
    expect(body.used).toBe(FREE_LIMIT);
    expect(body.limit).toBe(FREE_LIMIT);
    expect(typeof body.resetsAt).toBe("string");
  });

  it("does not stamp classifyingAt or enqueue a job when quota is exceeded", async () => {
    mockResolveInboxQuota.mockResolvedValue({ inboxKey: "ben@gmail.com", windowStart: new Date(), plan: "FREE", used: FREE_LIMIT });
    await post(`/workspaces/${WS_ID}/email-threads/${THREAD_ID}/ai-classify`);
    expect(db.emailThread.update).not.toHaveBeenCalled();
    expect(classifyThreadQueue.add).not.toHaveBeenCalled();
  });

  it("uses the inbox plan-ceiling limit (PRO allows more threads per month than FREE)", async () => {
    // Over the FREE limit but under the PRO limit.
    mockResolveInboxQuota.mockResolvedValue({ inboxKey: "ben@gmail.com", windowStart: new Date(), plan: "PRO", used: FREE_LIMIT + 1 });
    const res = await post(`/workspaces/${WS_ID}/email-threads/${THREAD_ID}/ai-classify`);
    expect(res.status).toBe(202);
  });

  it("skips the quota check when there is no active Gmail connection", async () => {
    // No inbox to meter against → the soft pre-check is skipped (the worker is
    // authoritative); the sort proceeds.
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue(null);
    const res = await post(`/workspaces/${WS_ID}/email-threads/${THREAD_ID}/ai-classify`);
    expect(res.status).toBe(202);
    expect(mockResolveInboxQuota).not.toHaveBeenCalled();
  });

  it("skips the quota check entirely when enforcement is disabled", async () => {
    mockBilling.enforceThreadSortQuota = false;
    // Usage at the FREE limit — should still proceed because enforcement is off.
    mockResolveInboxQuota.mockResolvedValue({ inboxKey: "ben@gmail.com", windowStart: new Date(), plan: "FREE", used: FREE_LIMIT });
    const res = await post(`/workspaces/${WS_ID}/email-threads/${THREAD_ID}/ai-classify`);
    expect(res.status).toBe(202);
    expect(mockResolveInboxQuota).not.toHaveBeenCalled();
  });
});
