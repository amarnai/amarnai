import { vi, describe, it, expect, beforeEach } from "vitest";
import { authed, TEST_USER_ID } from "./helpers.js";

vi.mock("@amarnai/db", () => ({
  db: {
    emailThread: { findFirst: vi.fn(), update: vi.fn() },
    emailClassification: { findFirst: vi.fn() },
    taxonomyNode: { findFirst: vi.fn() },
    workspaceMember: { findUnique: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("../queues.js", () => ({
  captureReferenceQueue: { add: vi.fn().mockResolvedValue({}) },
}));

import app from "../app.js";
import { db } from "@amarnai/db";
import { captureReferenceQueue } from "../queues.js";

const WS_ID = "ws-1";
const THREAD_ID = "thread-1";
const USER_ID = "user-1";
const NODE_ID = "node-leaf";
const CLS_ID = "cls-1";

// Capture the create call made inside the $transaction callback.
const txClassificationCreate = vi.fn();
const txThreadUpdate = vi.fn();
const txReferenceUpsert = vi.fn();
const txReferenceDeleteMany = vi.fn();

function patch(body: unknown) {
  return app.request(
    `/workspaces/${WS_ID}/email-threads/${THREAD_ID}/triage`,
    authed({
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.workspaceMember.findUnique).mockResolvedValue({ userId: USER_ID } as never);
  vi.mocked(db.emailThread.findFirst).mockResolvedValue({ id: THREAD_ID, triageStatus: "NEEDS_REVIEW" } as never);
  vi.mocked(db.taxonomyNode.findFirst).mockResolvedValue({
    id: NODE_ID,
    name: "Clients",
    isRoot: false,
    isCatchAll: false,
  } as never);
  // Prior AI decision the user is reacting to: a quality-gate fallback
  // (finalNodeId null, decisionSource inbox_fallback) with its gate score in
  // routing telemetry. This is the calibration feature paired with the verdict.
  vi.mocked(db.emailClassification.findFirst).mockResolvedValue({
    id: CLS_ID,
    finalNodeId: null,
    decisionSource: "inbox_fallback",
    source: "LIVE",
    rawOutput: { maxSubtreeScore: 0.1 },
  } as never);
  vi.mocked(db.$transaction).mockImplementation((async (cb: (tx: unknown) => unknown) =>
    cb({
      emailClassification: { create: txClassificationCreate },
      emailThread: { update: txThreadUpdate },
      taxonomyNodeReference: { upsert: txReferenceUpsert, deleteMany: txReferenceDeleteMany },
    })) as never);
});

describe("PATCH /workspaces/:workspaceId/email-threads/:threadId/triage — move", () => {
  it("tags the manual move classification with source MOVE (exempt from the quota)", async () => {
    const res = await patch({ action: "move", nodeId: NODE_ID });

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.triageStatus).toBe("SORTED");
    expect(body.movedToNodeId).toBe(NODE_ID);

    // A manual folder move runs no embedding/LLM, so it must not be metered:
    // it is recorded with source MOVE, which countRecurringThreadSorts excludes.
    expect(txClassificationCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ source: "MOVE" }) })
    );
  });

  it("returns 404 when the target node is not in the workspace", async () => {
    vi.mocked(db.taxonomyNode.findFirst).mockResolvedValue(null);
    const res = await patch({ action: "move", nodeId: NODE_ID });
    expect(res.status).toBe(404);
    expect(txClassificationCreate).not.toHaveBeenCalled();
  });

  it("records a thread.moved correction label pairing the AI decision with the chosen folder", async () => {
    await patch({ action: "move", nodeId: NODE_ID });

    expect(db.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorType: "USER",
          actorUserId: TEST_USER_ID,
          eventType: "thread.moved",
          entityType: "EmailThread",
          entityId: THREAD_ID,
          metadata: expect.objectContaining({
            classificationId: CLS_ID,
            scoreAtDecision: 0.1,
            decisionSource: "inbox_fallback",
            aiNodeId: null,
            chosenNodeId: NODE_ID,
            priorTriageStatus: "NEEDS_REVIEW",
          }),
        }),
      })
    );
  });

  it("does not record an audit label when the move fails validation", async () => {
    vi.mocked(db.taxonomyNode.findFirst).mockResolvedValue(null);
    await patch({ action: "move", nodeId: NODE_ID });
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });
});

describe("PATCH triage — move: sorting references", () => {
  it("upserts the thread's reference row and enqueues the embedding capture", async () => {
    const res = await patch({ action: "move", nodeId: NODE_ID });

    expect(res.status).toBe(200);
    // Upsert keyed by thread: a re-move repoints nodeId, keeping the vector.
    expect(txReferenceUpsert).toHaveBeenCalledWith({
      where: { emailThreadId: THREAD_ID },
      create: { workspaceId: WS_ID, nodeId: NODE_ID, emailThreadId: THREAD_ID },
      update: { nodeId: NODE_ID },
    });
    expect(txReferenceDeleteMany).not.toHaveBeenCalled();
    expect(captureReferenceQueue.add).toHaveBeenCalledWith("capture-reference", {
      workspaceId: WS_ID,
      emailThreadId: THREAD_ID,
    });
  });

  it("retractReference deletes the reference instead of upserting (undo semantics)", async () => {
    const res = await patch({ action: "move", nodeId: NODE_ID, retractReference: true });

    expect(res.status).toBe(200);
    // The move itself still happens…
    expect(txClassificationCreate).toHaveBeenCalled();
    // …but the reference is retracted, not laundered onto the restored folder.
    expect(txReferenceUpsert).not.toHaveBeenCalled();
    expect(txReferenceDeleteMany).toHaveBeenCalledWith({
      where: { emailThreadId: THREAD_ID, workspaceId: WS_ID },
    });
    expect(captureReferenceQueue.add).not.toHaveBeenCalled();
  });

  it("a move to the catch-all folder clears the reference and captures nothing", async () => {
    vi.mocked(db.taxonomyNode.findFirst).mockResolvedValue({
      id: NODE_ID,
      name: "Updates / Other",
      isRoot: false,
      isCatchAll: true,
    } as never);

    const res = await patch({ action: "move", nodeId: NODE_ID });

    expect(res.status).toBe(200);
    // Catch-all is excluded from routing scores, so a reference there would
    // never be read — and "this is junk" supersedes any earlier folder choice.
    expect(txReferenceUpsert).not.toHaveBeenCalled();
    expect(txReferenceDeleteMany).toHaveBeenCalled();
    expect(captureReferenceQueue.add).not.toHaveBeenCalled();
  });

  it("a move to the root (Inbox) clears the reference and captures nothing", async () => {
    vi.mocked(db.taxonomyNode.findFirst).mockResolvedValue({
      id: NODE_ID,
      name: "Inbox",
      isRoot: true,
      isCatchAll: false,
    } as never);

    const res = await patch({ action: "move", nodeId: NODE_ID });

    expect(res.status).toBe(200);
    expect(txReferenceUpsert).not.toHaveBeenCalled();
    expect(txReferenceDeleteMany).toHaveBeenCalled();
    expect(captureReferenceQueue.add).not.toHaveBeenCalled();
  });

  it("a failed enqueue does not fail the move (best-effort capture)", async () => {
    vi.mocked(captureReferenceQueue.add).mockRejectedValueOnce(new Error("redis down"));

    const res = await patch({ action: "move", nodeId: NODE_ID });

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.triageStatus).toBe("SORTED");
  });

  it("approve never touches references", async () => {
    const res = await patch({ action: "approve" });

    expect(res.status).toBe(200);
    expect(txReferenceUpsert).not.toHaveBeenCalled();
    expect(txReferenceDeleteMany).not.toHaveBeenCalled();
    expect(captureReferenceQueue.add).not.toHaveBeenCalled();
  });
});

describe("PATCH /workspaces/:workspaceId/email-threads/:threadId/triage — approve", () => {
  it("records a thread.approved positive label with chosenNodeId equal to the AI node", async () => {
    vi.mocked(db.emailClassification.findFirst).mockResolvedValue({
      id: CLS_ID,
      finalNodeId: NODE_ID,
      decisionSource: "embedding_auto",
      source: "LIVE",
      rawOutput: { maxSubtreeScore: 0.42 },
    } as never);

    const res = await patch({ action: "approve" });

    expect(res.status).toBe(200);
    expect(db.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: "thread.approved",
          entityId: THREAD_ID,
          metadata: expect.objectContaining({
            classificationId: CLS_ID,
            scoreAtDecision: 0.42,
            decisionSource: "embedding_auto",
            aiNodeId: NODE_ID,
            chosenNodeId: NODE_ID,
          }),
        }),
      })
    );
  });
});
