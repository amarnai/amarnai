import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("./client", () => ({
  db: {
    taxonomyNode: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  },
}));

import { db } from "./client";
import { ensureInboxNode } from "./inbox";

const WS_ID = "ws-test-1";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ensureInboxNode", () => {
  it("creates an Inbox root node when none exists", async () => {
    vi.mocked(db.taxonomyNode.findFirst).mockResolvedValue(null);
    vi.mocked(db.taxonomyNode.create).mockResolvedValue({} as never);

    await ensureInboxNode(WS_ID);

    expect(db.taxonomyNode.create).toHaveBeenCalledWith({
      data: {
        workspaceId: WS_ID,
        name: "Inbox",
        isRoot: true,
      },
    });
  });

  it("is idempotent — skips creation if a root node already exists", async () => {
    vi.mocked(db.taxonomyNode.findFirst).mockResolvedValue({ id: "existing-root" } as never);

    await ensureInboxNode(WS_ID);

    expect(db.taxonomyNode.create).not.toHaveBeenCalled();
  });

  it("queries by workspaceId and isRoot:true", async () => {
    vi.mocked(db.taxonomyNode.findFirst).mockResolvedValue({ id: "r" } as never);

    await ensureInboxNode(WS_ID);

    expect(db.taxonomyNode.findFirst).toHaveBeenCalledWith({
      where: { workspaceId: WS_ID, isRoot: true },
      select: { id: true },
    });
  });
});
