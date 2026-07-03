import { vi, describe, it, expect, beforeEach } from "vitest";
import { authed, TEST_USER_ID } from "./helpers.js";

vi.mock("@amarnai/db", () => ({
  db: {
    notification: {
      findMany: vi.fn(),
      count: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

import app from "../app.js";
import { db } from "@amarnai/db";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /notifications", () => {
  it("lists only the authenticated user's notifications", async () => {
    vi.mocked(db.notification.findMany).mockResolvedValue([
      { id: "n1", workspaceId: "ws-1", type: "thread_assigned", params: {}, readAt: null, createdAt: new Date() },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any);

    const res = await app.request("/notifications", authed());

    expect(res.status).toBe(200);
    const body = await res.json() as { notifications: { id: string }[] };
    expect(body.notifications).toHaveLength(1);
    // Scoped to the authenticated user id.
    expect(db.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: TEST_USER_ID }) }),
    );
  });
});

describe("GET /notifications/unread-count", () => {
  it("returns the unread count for the user", async () => {
    vi.mocked(db.notification.count).mockResolvedValue(3);

    const res = await app.request("/notifications/unread-count", authed());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ count: 3 });
    expect(db.notification.count).toHaveBeenCalledWith({
      where: { userId: TEST_USER_ID, readAt: null },
    });
  });
});

describe("POST /notifications/:id/read", () => {
  it("marks one notification read, scoped to the user (idempotent)", async () => {
    vi.mocked(db.notification.updateMany).mockResolvedValue({ count: 1 } as never);

    const res = await app.request("/notifications/n1/read", authed({ method: "POST" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(db.notification.updateMany).toHaveBeenCalledWith({
      where: { id: "n1", userId: TEST_USER_ID, readAt: null },
      data: expect.objectContaining({ readAt: expect.any(Date) }),
    });
  });

  it("is a no-op on a foreign id (still ok)", async () => {
    // updateMany matches zero rows when the id belongs to someone else.
    vi.mocked(db.notification.updateMany).mockResolvedValue({ count: 0 } as never);

    const res = await app.request("/notifications/other/read", authed({ method: "POST" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("POST /notifications/read-all", () => {
  it("marks all the user's unread notifications read", async () => {
    vi.mocked(db.notification.updateMany).mockResolvedValue({ count: 4 } as never);

    const res = await app.request("/notifications/read-all", authed({ method: "POST" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, updated: 4 });
    expect(db.notification.updateMany).toHaveBeenCalledWith({
      where: { userId: TEST_USER_ID, readAt: null },
      data: expect.objectContaining({ readAt: expect.any(Date) }),
    });
  });
});

describe("POST /notifications/update", () => {
  it("marks a batch read, scoped to the user", async () => {
    vi.mocked(db.notification.updateMany).mockResolvedValue({ count: 2 } as never);

    const res = await app.request(
      "/notifications/update",
      authed({ method: "POST", body: JSON.stringify({ ids: ["n1", "n2"], read: true }) }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, updated: 2 });
    expect(db.notification.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["n1", "n2"] }, userId: TEST_USER_ID },
      data: { readAt: expect.any(Date) },
    });
  });

  it("marks a batch unread by clearing readAt", async () => {
    vi.mocked(db.notification.updateMany).mockResolvedValue({ count: 1 } as never);

    const res = await app.request(
      "/notifications/update",
      authed({ method: "POST", body: JSON.stringify({ ids: ["n1"], read: false }) }),
    );

    expect(res.status).toBe(200);
    expect(db.notification.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["n1"] }, userId: TEST_USER_ID },
      data: { readAt: null },
    });
  });

  it("rejects an empty id list", async () => {
    const res = await app.request(
      "/notifications/update",
      authed({ method: "POST", body: JSON.stringify({ ids: [], read: true }) }),
    );
    expect(res.status).toBe(400);
    expect(db.notification.updateMany).not.toHaveBeenCalled();
  });
});

describe("POST /notifications/delete", () => {
  it("deletes a batch, scoped to the user", async () => {
    vi.mocked(db.notification.deleteMany).mockResolvedValue({ count: 3 } as never);

    const res = await app.request(
      "/notifications/delete",
      authed({ method: "POST", body: JSON.stringify({ ids: ["n1", "n2", "n3"] }) }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, deleted: 3 });
    expect(db.notification.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["n1", "n2", "n3"] }, userId: TEST_USER_ID },
    });
  });

  it("rejects an empty id list", async () => {
    const res = await app.request(
      "/notifications/delete",
      authed({ method: "POST", body: JSON.stringify({ ids: [] }) }),
    );
    expect(res.status).toBe(400);
    expect(db.notification.deleteMany).not.toHaveBeenCalled();
  });
});
