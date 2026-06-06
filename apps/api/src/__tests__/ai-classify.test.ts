import { vi, describe, it, expect, beforeEach } from "vitest";
import { authed } from "./helpers.js";

const mockBilling = vi.hoisted(() => ({ enforceThreadSortQuota: true }));

vi.mock("@amarnai/config", () => ({
  config: {
    redis: { url: "redis://localhost:6379" },
    billing: mockBilling,
    internalApiSecret: "dev-internal-secret",
  },
}));

vi.mock("@amarnai/db", () => ({
  Prisma: {},
  db: {
    emailThread: { findFirst: vi.fn(), update: vi.fn() },
    taxonomyNode: { count: vi.fn(), findMany: vi.fn() },
    emailClassification: { create: vi.fn(), findFirst: vi.fn() },
    workspace: { findUnique: vi.fn() },
    workspaceMember: { findUnique: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));

vi.mock("../queues.js", () => ({
  classifyThreadQueue: { add: vi.fn().mockResolvedValue({}) },
}));

import app from "../app.js";
import { db } from "@amarnai/db";
import { classifyThreadQueue } from "../queues.js";

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

const NODES = [
  { id: "node-root", name: "Inbox", isRoot: true },
  { id: "node-leaf", name: "Clients", isRoot: false },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockBilling.enforceThreadSortQuota = true;
  vi.mocked(db.workspaceMember.findUnique).mockResolvedValue({ userId: "test-user-1" } as never);
  vi.mocked(db.taxonomyNode.count).mockResolvedValue(2 as never);
  vi.mocked(db.taxonomyNode.findMany).mockResolvedValue(NODES as never);
  vi.mocked(db.emailThread.findFirst).mockResolvedValue(THREAD as never);
  vi.mocked(db.emailThread.update).mockResolvedValue({} as never);
  vi.mocked(db.emailClassification.create).mockResolvedValue({ id: "cls-1" } as never);
  vi.mocked(db.emailClassification.findFirst).mockResolvedValue({ id: "cls-existing" } as never);
  vi.mocked(classifyThreadQueue.add).mockResolvedValue({} as never);
  // Default workspace: FREE plan, 0 threads sorted this month (well under the 500 limit).
  vi.mocked(db.workspace.findUnique).mockResolvedValue({ plan: "FREE" } as never);
  vi.mocked(db.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([{ count: BigInt(0) }]);
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

  it("returns 422 when no taxonomy nodes exist", async () => {
    vi.mocked(db.taxonomyNode.count).mockResolvedValue(0 as never);
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
      { workspaceId: WS_ID, emailThreadId: THREAD_ID },
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
    // 499 of 500 FREE-plan slots used — one remaining.
    vi.mocked(db.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([{ count: BigInt(499) }]);
    const res = await post(`/workspaces/${WS_ID}/email-threads/${THREAD_ID}/ai-classify`);
    expect(res.status).toBe(202);
    expect(classifyThreadQueue.add).toHaveBeenCalledOnce();
  });

  it("returns 429 with quota details when the monthly limit is reached", async () => {
    // 500 of 500 — at the FREE limit.
    vi.mocked(db.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([{ count: BigInt(500) }]);
    const res = await post(`/workspaces/${WS_ID}/email-threads/${THREAD_ID}/ai-classify`);
    expect(res.status).toBe(429);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toMatch(/quota exceeded/i);
    expect(body.used).toBe(500);
    expect(body.limit).toBe(500);
    expect(typeof body.resetsAt).toBe("string");
  });

  it("does not stamp classifyingAt or enqueue a job when quota is exceeded", async () => {
    vi.mocked(db.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([{ count: BigInt(500) }]);
    await post(`/workspaces/${WS_ID}/email-threads/${THREAD_ID}/ai-classify`);
    expect(db.emailThread.update).not.toHaveBeenCalled();
    expect(classifyThreadQueue.add).not.toHaveBeenCalled();
  });

  it("uses the plan-specific limit (PRO allows 10 000 threads per month)", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({ plan: "PRO" } as never);
    // 500 used — over the FREE limit but under the PRO limit of 10 000.
    vi.mocked(db.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([{ count: BigInt(500) }]);
    const res = await post(`/workspaces/${WS_ID}/email-threads/${THREAD_ID}/ai-classify`);
    expect(res.status).toBe(202);
  });

  it("returns 404 if workspace is not found during quota check", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue(null);
    const res = await post(`/workspaces/${WS_ID}/email-threads/${THREAD_ID}/ai-classify`);
    expect(res.status).toBe(404);
  });

  it("skips the quota check entirely when enforcement is disabled", async () => {
    mockBilling.enforceThreadSortQuota = false;
    // Usage at the FREE limit — should still proceed because enforcement is off.
    vi.mocked(db.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([{ count: BigInt(500) }]);
    const res = await post(`/workspaces/${WS_ID}/email-threads/${THREAD_ID}/ai-classify`);
    expect(res.status).toBe(202);
    expect(db.workspace.findUnique).not.toHaveBeenCalled();
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });
});

// ─── mock-classify ────────────────────────────────────────────────────────────

describe("POST /workspaces/:workspaceId/email-threads/:threadId/mock-classify", () => {
  it("returns 201 with classification result", async () => {
    const res = await post(
      `/workspaces/${WS_ID}/email-threads/${THREAD_ID}/mock-classify`
    );
    expect(res.status).toBe(201);
    expect(db.emailClassification.create).toHaveBeenCalledTimes(1);
  });

  it("returns 404 when thread not found", async () => {
    vi.mocked(db.emailThread.findFirst).mockResolvedValue(null);
    const res = await post(
      `/workspaces/${WS_ID}/email-threads/${THREAD_ID}/mock-classify`
    );
    expect(res.status).toBe(404);
  });
});
