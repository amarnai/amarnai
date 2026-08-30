import { vi, describe, it, expect, beforeEach } from "vitest";
import { authed } from "./helpers.js";

function authedUser(userId = "u1"): RequestInit {
  return authed({ headers: { "X-User-Id": userId } });
}

vi.mock("@aziru/db", () => ({
  db: {
    workspace: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    emailThread: {
      findFirst: vi.fn(),
    },
  },
}));

import app from "../app.js";
import { db } from "@aziru/db";

describe("GET /workspaces", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a list of workspaces", async () => {
    const mockWorkspaces = [
      {
        id: "ws1",
        name: "Demo Workspace",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        owner: { id: "u1", email: "demo@amarnai.local", name: "Demo User" },
        members: [
          {
            id: "m1",
            role: "OWNER",
            user: { id: "u1", email: "demo@amarnai.local", name: "Demo User" },
          },
        ],
      },
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(db.workspace.findMany).mockResolvedValue(mockWorkspaces as any);

    const res = await app.request("/workspaces", authedUser());
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string; name: string }>;
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ id: "ws1", name: "Demo Workspace" });
    expect(db.workspace.findMany).toHaveBeenCalledOnce();
  });

  it("returns an empty list when no workspaces exist for the user", async () => {
    vi.mocked(db.workspace.findMany).mockResolvedValue([]);

    const res = await app.request("/workspaces", authedUser());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});
