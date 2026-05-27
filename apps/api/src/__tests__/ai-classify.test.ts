import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@amarnai/db", () => ({
  Prisma: {},
  db: {
    emailThread: { findFirst: vi.fn(), update: vi.fn() },
    taxonomyNode: { count: vi.fn(), findMany: vi.fn() },
    emailClassification: { create: vi.fn() },
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
  return app.request(path, { method: "POST" });
}

const NODES = [
  { id: "node-root", name: "Inbox", isRoot: true },
  { id: "node-leaf", name: "Clients", isRoot: false },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.taxonomyNode.count).mockResolvedValue(2 as never);
  vi.mocked(db.taxonomyNode.findMany).mockResolvedValue(NODES as never);
  vi.mocked(db.emailThread.findFirst).mockResolvedValue(THREAD as never);
  vi.mocked(db.emailThread.update).mockResolvedValue({} as never);
  vi.mocked(db.emailClassification.create).mockResolvedValue({ id: "cls-1" } as never);
  vi.mocked(classifyThreadQueue.add).mockResolvedValue({} as never);
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
