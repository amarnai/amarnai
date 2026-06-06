import { vi, describe, it, expect, beforeEach } from "vitest";
import { authed } from "./helpers.js";

vi.mock("@amarnai/db", () => ({
  db: {
    workspace: {
      findUnique: vi.fn(),
    },
    workspaceMember: {
      findUnique: vi.fn(),
    },
    gmailConnection: {
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

import app from "../app.js";
import { db } from "@amarnai/db";

const WS_ID = "ws-1";
const OTHER_WS_ID = "ws-other";

const baseConnection = {
  id: "conn-1",
  workspaceId: WS_ID,
  gmailAddress: "user@gmail.com",
  grantedScopes: ["https://www.googleapis.com/auth/gmail.readonly"],
  status: "ACTIVE",
  lastVerifiedAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.workspaceMember.findUnique).mockResolvedValue({ userId: "test-user-1" } as never);
});

// ─── GET /workspaces/:workspaceId/gmail-connection ─────────────────────────

describe("GET /workspaces/:workspaceId/gmail-connection", () => {
  it("returns the connection when one exists", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: WS_ID } as never);
    vi.mocked(db.gmailConnection.findUnique).mockResolvedValue(baseConnection as never);

    const res = await app.request(`/workspaces/${WS_ID}/gmail-connection`, authed());
    expect(res.status).toBe(200);
    const body = (await res.json()) as typeof baseConnection;
    expect(body).toMatchObject({ gmailAddress: "user@gmail.com", status: "ACTIVE" });
  });

  it("returns null when no connection exists", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: WS_ID } as never);
    vi.mocked(db.gmailConnection.findUnique).mockResolvedValue(null);

    const res = await app.request(`/workspaces/${WS_ID}/gmail-connection`, authed());
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });

  it("returns 404 when workspace does not exist", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue(null);

    const res = await app.request(`/workspaces/nope/gmail-connection`, authed());
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/workspace not found/i);
  });

  it("does not expose encryptedRefreshToken in the response", async () => {
    const withToken = {
      ...baseConnection,
      encryptedRefreshToken: "secret-encrypted-token",
    };
    vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: WS_ID } as never);
    vi.mocked(db.gmailConnection.findUnique).mockResolvedValue(withToken as never);

    const res = await app.request(`/workspaces/${WS_ID}/gmail-connection`, authed());
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty("encryptedRefreshToken");
  });

  it("only has the gmail.readonly scope in the granted scopes", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: WS_ID } as never);
    vi.mocked(db.gmailConnection.findUnique).mockResolvedValue(baseConnection as never);

    const res = await app.request(`/workspaces/${WS_ID}/gmail-connection`, authed());
    const body = (await res.json()) as typeof baseConnection;
    expect(body.grantedScopes).toEqual(["https://www.googleapis.com/auth/gmail.readonly"]);
    expect(body.grantedScopes).not.toContain("https://mail.google.com/");
    expect(body.grantedScopes).not.toContain("https://www.googleapis.com/auth/gmail.modify");
    expect(body.grantedScopes).not.toContain("https://www.googleapis.com/auth/gmail.compose");
    expect(body.grantedScopes).not.toContain("https://www.googleapis.com/auth/gmail.send");
    expect(body.grantedScopes).not.toContain("https://www.googleapis.com/auth/gmail.labels");
  });
});

// ─── DELETE /workspaces/:workspaceId/gmail-connection ─────────────────────

describe("DELETE /workspaces/:workspaceId/gmail-connection", () => {
  it("disconnects when a connection exists", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: WS_ID } as never);
    vi.mocked(db.gmailConnection.findUnique).mockResolvedValue(baseConnection as never);
    vi.mocked(db.gmailConnection.delete).mockResolvedValue(baseConnection as never);

    const res = await app.request(`/workspaces/${WS_ID}/gmail-connection`, authed({ method: "DELETE" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
    expect(db.gmailConnection.delete).toHaveBeenCalledWith({
      where: { workspaceId: WS_ID },
    });
  });

  it("returns 404 when no connection exists", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: WS_ID } as never);
    vi.mocked(db.gmailConnection.findUnique).mockResolvedValue(null);

    const res = await app.request(`/workspaces/${WS_ID}/gmail-connection`, authed({ method: "DELETE" }));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/no gmail connection/i);
  });

  it("returns 404 when workspace does not exist", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue(null);

    const res = await app.request(`/workspaces/nope/gmail-connection`, authed({ method: "DELETE" }));
    expect(res.status).toBe(404);
  });

  it("does not affect connections belonging to other workspaces", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: WS_ID } as never);
    vi.mocked(db.gmailConnection.findUnique).mockResolvedValue(null);

    const res = await app.request(`/workspaces/${WS_ID}/gmail-connection`, authed({ method: "DELETE" }));
    expect(res.status).toBe(404);
    expect(db.gmailConnection.delete).not.toHaveBeenCalled();
  });
});

// ─── One connection per workspace enforcement ──────────────────────────────

describe("One GmailConnection per workspace", () => {
  it("GET returns the single connection for a workspace", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: WS_ID } as never);
    vi.mocked(db.gmailConnection.findUnique).mockResolvedValue(baseConnection as never);

    const res1 = await app.request(`/workspaces/${WS_ID}/gmail-connection`, authed());
    expect(res1.status).toBe(200);

    // A different workspace has no connection
    vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: OTHER_WS_ID } as never);
    vi.mocked(db.gmailConnection.findUnique).mockResolvedValue(null);

    const res2 = await app.request(`/workspaces/${OTHER_WS_ID}/gmail-connection`, authed());
    expect(res2.status).toBe(200);
    expect(await res2.json()).toBeNull();
  });
});
