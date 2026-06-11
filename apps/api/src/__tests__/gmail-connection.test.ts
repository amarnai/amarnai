import { vi, describe, it, expect, beforeEach } from "vitest";
import { authed, TEST_USER_ID } from "./helpers.js";

const { mockStopWatch, mockRevokeGoogleToken } = vi.hoisted(() => ({
  mockStopWatch: vi.fn(),
  mockRevokeGoogleToken: vi.fn(),
}));

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
      findMany: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    emailAccount: {
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    emailThread: {
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    emailMessage: {
      deleteMany: vi.fn(),
    },
    emailClassification: {
      deleteMany: vi.fn(),
    },
    emailTag: {
      deleteMany: vi.fn(),
    },
    draft: {
      deleteMany: vi.fn(),
    },
    emailAddressIdentity: {
      deleteMany: vi.fn(),
    },
    providerSyncState: {
      deleteMany: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("@amarnai/gmail", () => ({
  GmailClient: vi.fn().mockImplementation(() => ({
    stopWatch: mockStopWatch,
  })),
  revokeGoogleToken: mockRevokeGoogleToken,
}));

vi.mock("../queues.js", () => ({
  classifyThreadQueue: {
    getJobs: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../services/queue-client.js", () => ({
  syncInboxQueue: {
    getDeduplicationJobId: vi.fn().mockResolvedValue(null),
  },
  backfillInboxQueue: {
    getDeduplicationJobId: vi.fn().mockResolvedValue(null),
  },
}));

import app from "../app.js";
import { db } from "@amarnai/db";
import { revokeGoogleToken, GmailClient } from "@amarnai/gmail";

const WS_ID = "ws-1";
const OTHER_WS_ID = "ws-other";

const baseConnection = {
  id: "conn-1",
  workspaceId: WS_ID,
  gmailAddress: "user@gmail.com",
  googleSubjectId: null,
  encryptedRefreshToken: "encrypted-token",
  grantedScopes: ["https://www.googleapis.com/auth/gmail.readonly"],
  status: "ACTIVE" as const,
  lastVerifiedAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const baseEmailAccount = { id: "acct-1" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.workspaceMember.findUnique).mockResolvedValue({ userId: TEST_USER_ID } as never);
  vi.mocked(db.gmailConnection.update).mockResolvedValue({} as never);
  vi.mocked(db.gmailConnection.count).mockResolvedValue(0); // no siblings by default
  vi.mocked(db.gmailConnection.findMany).mockResolvedValue([]); // no visible siblings by default
  vi.mocked(db.emailAccount.findUnique).mockResolvedValue(baseEmailAccount as never);
  vi.mocked(db.emailAccount.update).mockResolvedValue({} as never);
  vi.mocked(db.emailThread.updateMany).mockResolvedValue({ count: 0 } as never);
  vi.mocked(db.auditLog.create).mockResolvedValue({} as never);
  mockStopWatch.mockResolvedValue(undefined);
  mockRevokeGoogleToken.mockResolvedValue(true);
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
    const withToken = { ...baseConnection, encryptedRefreshToken: "secret-encrypted-token" };
    vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: WS_ID } as never);
    vi.mocked(db.gmailConnection.findUnique).mockResolvedValue(withToken as never);

    const res = await app.request(`/workspaces/${WS_ID}/gmail-connection`, authed());
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty("encryptedRefreshToken");
  });

  it("reports an unshared mailbox when no other workspace syncs it", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: WS_ID } as never);
    vi.mocked(db.gmailConnection.findUnique).mockResolvedValue(baseConnection as never);

    const res = await app.request(`/workspaces/${WS_ID}/gmail-connection`, authed());
    const body = (await res.json()) as { sharedMailbox: boolean; alsoConnectedIn: unknown[] };
    expect(body.sharedMailbox).toBe(false);
    expect(body.alsoConnectedIn).toEqual([]);
  });

  it("reports sharedMailbox=true without leaking names when the sibling belongs to another tenant", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: WS_ID } as never);
    vi.mocked(db.gmailConnection.findUnique).mockResolvedValue(baseConnection as never);
    vi.mocked(db.gmailConnection.count).mockResolvedValue(1); // foreign-tenant sibling
    vi.mocked(db.gmailConnection.findMany).mockResolvedValue([]); // not visible to this user

    const res = await app.request(`/workspaces/${WS_ID}/gmail-connection`, authed());
    const body = (await res.json()) as { sharedMailbox: boolean; alsoConnectedIn: unknown[] };
    expect(body.sharedMailbox).toBe(true);
    expect(body.alsoConnectedIn).toEqual([]);
  });

  it("lists sibling workspaces the requesting user is a member of", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: WS_ID } as never);
    vi.mocked(db.gmailConnection.findUnique).mockResolvedValue(baseConnection as never);
    vi.mocked(db.gmailConnection.count).mockResolvedValue(1);
    vi.mocked(db.gmailConnection.findMany).mockResolvedValue([
      { workspace: { id: OTHER_WS_ID, name: "Benjamin Personal" } },
    ] as never);

    const res = await app.request(`/workspaces/${WS_ID}/gmail-connection`, authed());
    const body = (await res.json()) as { sharedMailbox: boolean; alsoConnectedIn: { id: string; name: string }[] };
    expect(body.sharedMailbox).toBe(true);
    expect(body.alsoConnectedIn).toEqual([{ id: OTHER_WS_ID, name: "Benjamin Personal" }]);
  });

  it("scopes the visible-siblings query to the requesting user's memberships", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: WS_ID } as never);
    vi.mocked(db.gmailConnection.findUnique).mockResolvedValue(baseConnection as never);

    await app.request(`/workspaces/${WS_ID}/gmail-connection`, authed());

    expect(vi.mocked(db.gmailConnection.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspace: { members: { some: { userId: TEST_USER_ID } } },
        }),
      })
    );
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
  it("sets DISCONNECTED instead of deleting the row", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: WS_ID } as never);
    vi.mocked(db.gmailConnection.findUnique).mockResolvedValue(baseConnection as never);

    const res = await app.request(`/workspaces/${WS_ID}/gmail-connection`, authed({ method: "DELETE" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);

    expect(vi.mocked(db.gmailConnection.update)).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "DISCONNECTED" }) })
    );
  });

  it("calls stopWatch before revokeGoogleToken", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: WS_ID } as never);
    vi.mocked(db.gmailConnection.findUnique).mockResolvedValue(baseConnection as never);

    const callOrder: string[] = [];
    mockStopWatch.mockImplementation(async () => { callOrder.push("stopWatch"); });
    mockRevokeGoogleToken.mockImplementation(async () => { callOrder.push("revoke"); return true; });

    await app.request(`/workspaces/${WS_ID}/gmail-connection`, authed({ method: "DELETE" }));

    expect(callOrder).toEqual(["stopWatch", "revoke"]);
    const body = (await (await app.request(`/workspaces/${WS_ID}/gmail-connection`, authed({ method: "DELETE" }))).json()) as { watchStopped: boolean; revoked: boolean };
    expect(body.watchStopped).toBe(true);
    expect(body.revoked).toBe(true);
  });

  it("succeeds even when stopWatch fails", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: WS_ID } as never);
    vi.mocked(db.gmailConnection.findUnique).mockResolvedValue(baseConnection as never);
    mockStopWatch.mockRejectedValue(new Error("watch stop failed"));
    mockRevokeGoogleToken.mockResolvedValue(true);

    const res = await app.request(`/workspaces/${WS_ID}/gmail-connection`, authed({ method: "DELETE" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; watchStopped: boolean; revoked: boolean };
    expect(body.ok).toBe(true);
    expect(body.watchStopped).toBe(false);
    expect(body.revoked).toBe(true);
  });

  it("succeeds even when revoke fails", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: WS_ID } as never);
    vi.mocked(db.gmailConnection.findUnique).mockResolvedValue(baseConnection as never);
    mockRevokeGoogleToken.mockResolvedValue(false);

    const res = await app.request(`/workspaces/${WS_ID}/gmail-connection`, authed({ method: "DELETE" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; revoked: boolean };
    expect(body.ok).toBe(true);
    expect(body.revoked).toBe(false);
  });

  it("skips Google-side teardown and returns sharedMailbox=true when another workspace shares the mailbox", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: WS_ID } as never);
    vi.mocked(db.gmailConnection.findUnique).mockResolvedValue(baseConnection as never);
    vi.mocked(db.gmailConnection.count).mockResolvedValue(1); // shared mailbox

    const res = await app.request(`/workspaces/${WS_ID}/gmail-connection`, authed({ method: "DELETE" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; sharedMailbox: boolean; revoked: boolean; watchStopped: boolean };
    expect(body.ok).toBe(true);
    expect(body.sharedMailbox).toBe(true);
    expect(body.revoked).toBe(false);
    expect(body.watchStopped).toBe(false);
    expect(vi.mocked(GmailClient)).not.toHaveBeenCalled();
    expect(vi.mocked(revokeGoogleToken)).not.toHaveBeenCalled();
  });

  it("does not erase email data without ?eraseData=true", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: WS_ID } as never);
    vi.mocked(db.gmailConnection.findUnique).mockResolvedValue(baseConnection as never);

    const res = await app.request(`/workspaces/${WS_ID}/gmail-connection`, authed({ method: "DELETE" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { erased: boolean };
    expect(body.erased).toBe(false);
    expect(vi.mocked(db.$transaction)).not.toHaveBeenCalled();
  });

  it("erases email data when ?eraseData=true", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: WS_ID } as never);
    vi.mocked(db.gmailConnection.findUnique).mockResolvedValue(baseConnection as never);
    vi.mocked(db.$transaction).mockResolvedValue([]);

    const res = await app.request(
      `/workspaces/${WS_ID}/gmail-connection?eraseData=true`,
      authed({ method: "DELETE" })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { erased: boolean };
    expect(body.erased).toBe(true);
    expect(vi.mocked(db.$transaction)).toHaveBeenCalled();
  });

  it("audit log entry contains no token material", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: WS_ID } as never);
    vi.mocked(db.gmailConnection.findUnique).mockResolvedValue(baseConnection as never);

    await app.request(`/workspaces/${WS_ID}/gmail-connection`, authed({ method: "DELETE" }));

    const auditCall = vi.mocked(db.auditLog.create).mock.calls[0]?.[0];
    expect(auditCall).toBeDefined();
    const metadata = auditCall!.data.metadata as Record<string, unknown>;
    expect(JSON.stringify(metadata)).not.toContain("encrypted-token");
    expect(JSON.stringify(metadata)).not.toContain("token");
    expect(auditCall!.data.eventType).toBe("gmail.disconnected");
    expect(auditCall!.data.actorUserId).toBe(TEST_USER_ID);
  });

  it("succeeds (idempotent) when connection is already DISCONNECTED", async () => {
    const disconnectedConn = { ...baseConnection, status: "DISCONNECTED" as const, encryptedRefreshToken: "" };
    vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: WS_ID } as never);
    vi.mocked(db.gmailConnection.findUnique).mockResolvedValue(disconnectedConn as never);

    const res = await app.request(`/workspaces/${WS_ID}/gmail-connection`, authed({ method: "DELETE" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
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
    expect(vi.mocked(db.gmailConnection.update)).not.toHaveBeenCalled();
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
