import { vi, describe, it, expect, beforeEach } from "vitest";
import { authed, TEST_USER_ID } from "./helpers.js";

vi.mock("@aziru/db", () => {
  class FreeWorkspaceLimitError extends Error {
    constructor() {
      super("You already have a free workspace.");
      this.name = "FreeWorkspaceLimitError";
    }
  }
  return {
    db: {
      workspace: {
        update: vi.fn(),
        count: vi.fn(),
        findUniqueOrThrow: vi.fn(),
      },
      workspaceMember: {
        findUnique: vi.fn(),
      },
      emailConnection: {
        findUnique: vi.fn(),
      },
    },
    resetWorkspaceData: vi.fn(),
    deleteWorkspaceCascade: vi.fn(),
    createFreeWorkspace: vi.fn(),
    FreeWorkspaceLimitError,
  };
});

vi.mock("../services/gmail-disconnect.js", () => ({
  disconnectGmail: vi.fn(),
}));

import app from "../app.js";
import { db, resetWorkspaceData, deleteWorkspaceCascade, createFreeWorkspace, FreeWorkspaceLimitError } from "@aziru/db";
import { disconnectGmail } from "../services/gmail-disconnect.js";

function asMember(role: "OWNER" | "MEMBER") {
  // Satisfies both requireWorkspaceMember (truthiness) and ownerRole (role).
  vi.mocked(db.workspaceMember.findUnique).mockResolvedValue({
    userId: TEST_USER_ID,
    role,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
}

function jsonBody(method: string, body?: unknown): RequestInit {
  return authed({
    method,
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PATCH /workspaces/:id (rename)", () => {
  it("renames when the user is OWNER", async () => {
    asMember("OWNER");
    vi.mocked(db.workspace.update).mockResolvedValue({
      id: "ws1",
      name: "Renamed",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const res = await app.request("/workspaces/ws1", jsonBody("PATCH", { name: "Renamed" }));

    expect(res.status).toBe(200);
    expect(((await res.json()) as { name: string }).name).toBe("Renamed");
    expect(db.workspace.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "ws1" }, data: { name: "Renamed" } }),
    );
  });

  it("trims the name before saving", async () => {
    asMember("OWNER");
    vi.mocked(db.workspace.update).mockResolvedValue({ id: "ws1", name: "Trimmed" } as never);

    await app.request("/workspaces/ws1", jsonBody("PATCH", { name: "  Trimmed  " }));

    expect(db.workspace.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { name: "Trimmed" } }),
    );
  });

  it("rejects a non-owner with 403", async () => {
    asMember("MEMBER");

    const res = await app.request("/workspaces/ws1", jsonBody("PATCH", { name: "Nope" }));

    expect(res.status).toBe(403);
    expect(db.workspace.update).not.toHaveBeenCalled();
  });

  it("rejects an empty name with 400 before any auth lookup", async () => {
    const res = await app.request("/workspaces/ws1", jsonBody("PATCH", { name: "   " }));

    expect(res.status).toBe(400);
    expect(db.workspace.update).not.toHaveBeenCalled();
  });

  it("rejects a name longer than 100 chars with 400", async () => {
    const res = await app.request("/workspaces/ws1", jsonBody("PATCH", { name: "a".repeat(101) }));

    expect(res.status).toBe(400);
  });

  it("updates the language when the user is OWNER", async () => {
    asMember("OWNER");
    vi.mocked(db.workspace.update).mockResolvedValue({ id: "ws1", locale: "fr" } as never);

    const res = await app.request("/workspaces/ws1", jsonBody("PATCH", { locale: "fr" }));

    expect(res.status).toBe(200);
    expect(db.workspace.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "ws1" }, data: { locale: "fr" } }),
    );
  });

  it("rejects an unsupported locale with 400 before any auth lookup", async () => {
    const res = await app.request("/workspaces/ws1", jsonBody("PATCH", { locale: "xx" }));

    expect(res.status).toBe(400);
    expect(db.workspace.update).not.toHaveBeenCalled();
  });

  it("rejects a non-owner changing the language with 403", async () => {
    asMember("MEMBER");

    const res = await app.request("/workspaces/ws1", jsonBody("PATCH", { locale: "fr" }));

    expect(res.status).toBe(403);
    expect(db.workspace.update).not.toHaveBeenCalled();
  });
});

describe("POST /workspaces/:id/reset", () => {
  it("resets when OWNER, disconnecting Gmail first when connected", async () => {
    asMember("OWNER");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue({ id: "c1" } as any);

    const res = await app.request("/workspaces/ws1/reset", jsonBody("POST"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(disconnectGmail).toHaveBeenCalledWith("ws1", {
      eraseData: true,
      actorUserId: TEST_USER_ID,
    });
    expect(resetWorkspaceData).toHaveBeenCalledWith("ws1");
  });

  it("skips Gmail disconnect when there is no connection", async () => {
    asMember("OWNER");
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue(null);

    const res = await app.request("/workspaces/ws1/reset", jsonBody("POST"));

    expect(res.status).toBe(200);
    expect(disconnectGmail).not.toHaveBeenCalled();
    expect(resetWorkspaceData).toHaveBeenCalledWith("ws1");
  });

  it("rejects a non-owner with 403", async () => {
    asMember("MEMBER");

    const res = await app.request("/workspaces/ws1/reset", jsonBody("POST"));

    expect(res.status).toBe(403);
    expect(resetWorkspaceData).not.toHaveBeenCalled();
  });
});

describe("POST /workspaces (create)", () => {
  const stubWorkspace = {
    id: "ws-new",
    name: "Acme",
    plan: "FREE",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    owner: { id: TEST_USER_ID, email: "user@example.com", name: null },
    members: [],
  };

  it("creates a workspace and returns 201", async () => {
    vi.mocked(createFreeWorkspace).mockResolvedValue("ws-new");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(db.workspace.findUniqueOrThrow).mockResolvedValue(stubWorkspace as any);

    const res = await app.request("/workspaces", jsonBody("POST", { name: "Acme" }));

    expect(res.status).toBe(201);
    // Locale is seeded from Accept-Language; absent here, it defaults to "en".
    expect(createFreeWorkspace).toHaveBeenCalledWith(TEST_USER_ID, "Acme", "en");
    expect(db.workspace.findUniqueOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "ws-new" } }),
    );
    expect(((await res.json()) as { id: string }).id).toBe("ws-new");
  });

  it("trims the name before creating", async () => {
    vi.mocked(createFreeWorkspace).mockResolvedValue("ws-new");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(db.workspace.findUniqueOrThrow).mockResolvedValue(stubWorkspace as any);

    await app.request("/workspaces", jsonBody("POST", { name: "  Acme  " }));

    expect(createFreeWorkspace).toHaveBeenCalledWith(TEST_USER_ID, "Acme", "en");
  });

  it("seeds the workspace language from Accept-Language", async () => {
    vi.mocked(createFreeWorkspace).mockResolvedValue("ws-new");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(db.workspace.findUniqueOrThrow).mockResolvedValue(stubWorkspace as any);

    const init = jsonBody("POST", { name: "Acme" });
    (init.headers as Record<string, string>)["Accept-Language"] = "fr-FR,fr;q=0.9,en;q=0.8";
    await app.request("/workspaces", init);

    expect(createFreeWorkspace).toHaveBeenCalledWith(TEST_USER_ID, "Acme", "fr");
  });

  it("returns 409 when free workspace limit is reached", async () => {
    vi.mocked(createFreeWorkspace).mockRejectedValue(new FreeWorkspaceLimitError());

    const res = await app.request("/workspaces", jsonBody("POST", { name: "Second" }));

    expect(res.status).toBe(409);
    expect(db.workspace.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it("returns 400 for an empty name", async () => {
    const res = await app.request("/workspaces", jsonBody("POST", { name: "   " }));

    expect(res.status).toBe(400);
    expect(createFreeWorkspace).not.toHaveBeenCalled();
  });

  it("returns 400 for a name longer than 100 characters", async () => {
    const res = await app.request("/workspaces", jsonBody("POST", { name: "a".repeat(101) }));

    expect(res.status).toBe(400);
    expect(createFreeWorkspace).not.toHaveBeenCalled();
  });
});

describe("DELETE /workspaces/:id", () => {
  it("deletes when OWNER and more than one owned workspace", async () => {
    asMember("OWNER");
    vi.mocked(db.workspace.count).mockResolvedValue(2);
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue(null);

    const res = await app.request("/workspaces/ws1", jsonBody("DELETE"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(deleteWorkspaceCascade).toHaveBeenCalledWith("ws1");
  });

  it("refuses to delete the only owned workspace with 409", async () => {
    asMember("OWNER");
    vi.mocked(db.workspace.count).mockResolvedValue(1);

    const res = await app.request("/workspaces/ws1", jsonBody("DELETE"));

    expect(res.status).toBe(409);
    expect(deleteWorkspaceCascade).not.toHaveBeenCalled();
  });

  it("rejects a non-owner with 403", async () => {
    asMember("MEMBER");

    const res = await app.request("/workspaces/ws1", jsonBody("DELETE"));

    expect(res.status).toBe(403);
    expect(deleteWorkspaceCascade).not.toHaveBeenCalled();
  });
});
