import { vi, describe, it, expect, beforeEach } from "vitest";
import { authed } from "./helpers.js";

vi.mock("@amarnai/db", () => ({
  db: {
    emailThread: { findFirst: vi.fn(), update: vi.fn() },
    taxonomyNode: { findFirst: vi.fn() },
    workspaceMember: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import app from "../app.js";
import { db } from "@amarnai/db";

const WS_ID = "ws-1";
const THREAD_ID = "thread-1";
const USER_ID = "user-1";
const NODE_ID = "node-leaf";

// Capture the create call made inside the $transaction callback.
const txClassificationCreate = vi.fn();
const txThreadUpdate = vi.fn();

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
  vi.mocked(db.taxonomyNode.findFirst).mockResolvedValue({ id: NODE_ID, name: "Clients" } as never);
  vi.mocked(db.$transaction).mockImplementation((async (cb: (tx: unknown) => unknown) =>
    cb({
      emailClassification: { create: txClassificationCreate },
      emailThread: { update: txThreadUpdate },
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
});
