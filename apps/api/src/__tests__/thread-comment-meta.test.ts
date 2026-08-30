import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@aziru/db", () => ({
  db: {
    threadComment: {
      groupBy: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    threadCommentRead: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

import { db } from "@aziru/db";
import { loadThreadCommentsMetaForThreads } from "../services/thread-comment-meta.js";

const groupBy = db.threadComment.groupBy as ReturnType<typeof vi.fn>;
const commentFindMany = db.threadComment.findMany as ReturnType<typeof vi.fn>;
const readFindMany = db.threadCommentRead.findMany as ReturnType<typeof vi.fn>;

const USER = "u-me";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("loadThreadCommentsMetaForThreads", () => {
  it("returns an empty map for no thread ids without querying", async () => {
    const meta = await loadThreadCommentsMetaForThreads([], USER);
    expect(meta.size).toBe(0);
    expect(groupBy).not.toHaveBeenCalled();
  });

  it("returns an empty map when no thread has comments", async () => {
    groupBy.mockResolvedValue([]);
    const meta = await loadThreadCommentsMetaForThreads(["t1", "t2"], USER);
    expect(meta.size).toBe(0);
    expect(commentFindMany).not.toHaveBeenCalled();
  });

  it("counts unread as others' comments newer than this member's marker", async () => {
    groupBy.mockResolvedValue([
      { emailThreadId: "t1", _count: { _all: 3 } },
      { emailThreadId: "t2", _count: { _all: 2 } },
      { emailThreadId: "t3", _count: { _all: 1 } },
    ]);
    // t1 has a marker covering the first of two others-authored comments;
    // t2's comments are all authored by the requesting member; t3 has no
    // marker, so its single others-authored comment is unread.
    readFindMany.mockResolvedValue([
      { emailThreadId: "t1", lastReadAt: new Date("2026-08-10T00:00:00Z") },
    ]);
    commentFindMany.mockResolvedValue([
      { emailThreadId: "t1", createdAt: new Date("2026-08-09T00:00:00Z") },
      { emailThreadId: "t1", createdAt: new Date("2026-08-11T00:00:00Z") },
      { emailThreadId: "t3", createdAt: new Date("2026-08-01T00:00:00Z") },
    ]);

    const meta = await loadThreadCommentsMetaForThreads(["t1", "t2", "t3"], USER);

    expect(meta.get("t1")).toEqual({ total: 3, unread: 1 });
    expect(meta.get("t2")).toEqual({ total: 2, unread: 0 });
    expect(meta.get("t3")).toEqual({ total: 1, unread: 1 });
    // Own comments are excluded in the query, not in memory.
    expect(commentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ authorUserId: { not: USER } }),
      }),
    );
  });

  it("treats a comment created exactly at the marker as read", async () => {
    const at = new Date("2026-08-10T00:00:00Z");
    groupBy.mockResolvedValue([{ emailThreadId: "t1", _count: { _all: 1 } }]);
    readFindMany.mockResolvedValue([{ emailThreadId: "t1", lastReadAt: at }]);
    commentFindMany.mockResolvedValue([{ emailThreadId: "t1", createdAt: at }]);

    const meta = await loadThreadCommentsMetaForThreads(["t1"], USER);
    expect(meta.get("t1")).toEqual({ total: 1, unread: 0 });
  });
});
