import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("./client", () => ({
  db: {
    taxonomyNode: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    taxonomyEdge: {
      create: vi.fn(),
    },
    // Interactive transaction: run the callback with `db` itself as the tx client.
    $transaction: vi.fn(),
  },
}));

import { db } from "./client";
import { ensureInboxTaxonomy } from "./inbox";
import {
  DEFAULT_CATCH_ALL_NAME,
  DEFAULT_CATCH_ALL_DESCRIPTION,
} from "@aziru/shared";

const WS_ID = "ws-test-1";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.$transaction).mockImplementation((async (fn: (tx: typeof db) => unknown) =>
    fn(db)) as never);
});

describe("ensureInboxTaxonomy", () => {
  it("creates the root and the catch-all (with its root edge) when neither exists", async () => {
    // findFirst: first call (root) → none, second call (catch-all) → none.
    vi.mocked(db.taxonomyNode.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    vi.mocked(db.taxonomyNode.create)
      .mockResolvedValueOnce({ id: "root-id" } as never) // root
      .mockResolvedValueOnce({ id: "catch-all-id" } as never); // catch-all
    vi.mocked(db.taxonomyEdge.create).mockResolvedValue({} as never);

    await ensureInboxTaxonomy(WS_ID);

    expect(db.taxonomyNode.create).toHaveBeenNthCalledWith(1, {
      data: { workspaceId: WS_ID, name: "Inbox", isRoot: true },
      select: { id: true },
    });
    expect(db.taxonomyNode.create).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({
        workspaceId: WS_ID,
        name: DEFAULT_CATCH_ALL_NAME,
        description: DEFAULT_CATCH_ALL_DESCRIPTION,
        isCatchAll: true,
      }),
      select: { id: true },
    });
    expect(db.taxonomyEdge.create).toHaveBeenCalledWith({
      data: { workspaceId: WS_ID, sourceNodeId: "root-id", targetNodeId: "catch-all-id" },
    });
  });

  it("is idempotent — creates nothing when both already exist", async () => {
    vi.mocked(db.taxonomyNode.findFirst)
      .mockResolvedValueOnce({ id: "existing-root" } as never)
      .mockResolvedValueOnce({ id: "existing-catch-all" } as never);

    await ensureInboxTaxonomy(WS_ID);

    expect(db.taxonomyNode.create).not.toHaveBeenCalled();
    expect(db.taxonomyEdge.create).not.toHaveBeenCalled();
  });

  it("backfills only the catch-all when the root exists but the catch-all is missing", async () => {
    vi.mocked(db.taxonomyNode.findFirst)
      .mockResolvedValueOnce({ id: "existing-root" } as never) // root present
      .mockResolvedValueOnce(null); // catch-all missing
    vi.mocked(db.taxonomyNode.create).mockResolvedValueOnce({ id: "catch-all-id" } as never);
    vi.mocked(db.taxonomyEdge.create).mockResolvedValue({} as never);

    await ensureInboxTaxonomy(WS_ID);

    // Root not recreated; only the catch-all node + its edge from the existing root.
    expect(db.taxonomyNode.create).toHaveBeenCalledTimes(1);
    expect(db.taxonomyNode.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ isCatchAll: true }),
      select: { id: true },
    });
    expect(db.taxonomyEdge.create).toHaveBeenCalledWith({
      data: { workspaceId: WS_ID, sourceNodeId: "existing-root", targetNodeId: "catch-all-id" },
    });
  });
});
