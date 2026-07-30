import { vi, describe, it, expect, beforeEach } from "vitest";
import { authed, TEST_USER_ID } from "./helpers.js";

const { mockStopWatch, mockRevokeGoogleToken } = vi.hoisted(() => ({
  mockStopWatch: vi.fn(),
  mockRevokeGoogleToken: vi.fn(),
}));

vi.mock("@amarnai/db", () => {
  const db = {
    workspace: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    workspaceMember: {
      findUnique: vi.fn(),
    },
    emailConnection: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
      count: vi.fn(),
    },
    // Written by the post-connect writeback enable step.
    gmailSyncSettings: { upsert: vi.fn() },
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
  };
  return {
    db,
    // Erase is extracted into @amarnai/db; keep the mock faithful to the real
    // export and route it through $transaction so the erase assertions hold.
    eraseEmailAccountData: vi.fn(async () => {
      await db.$transaction([]);
    }),
    eraseStaleEmailAccounts: vi.fn().mockResolvedValue([]),
    maybeCreateExtensionNudge: vi.fn().mockResolvedValue(undefined),
    deleteGmailDisconnectedNotifications: vi.fn().mockResolvedValue(undefined),
  };
});

const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

// @amarnai/auth (and its real storeGmailConnection) stays unmocked; we stub its
// gmail dependencies here so the real upsert path runs against the db mock.
vi.mock("@amarnai/gmail", () => ({
  GmailClient: vi.fn().mockImplementation(() => ({
    stopWatch: mockStopWatch,
  })),
  revokeGoogleToken: mockRevokeGoogleToken,
  // Literal, not the GMAIL_SCOPE const — this factory is hoisted above it.
  GMAIL_READONLY_SCOPE: "https://www.googleapis.com/auth/gmail.readonly",
  GMAIL_MODIFY_SCOPE: "https://www.googleapis.com/auth/gmail.modify",
  // Reached through @amarnai/mail's providerHasWritebackScope, which the connect
  // path calls to decide whether the new grant can write labels.
  hasWritebackScope: (scopes: readonly string[]) =>
    scopes.includes("https://www.googleapis.com/auth/gmail.modify"),
  parseGrantedScopes: (scope: string) => {
    const scopes = scope.split(" ");
    return {
      scopes,
      hasReadonly:
        scopes.includes("https://www.googleapis.com/auth/gmail.readonly") ||
        scopes.includes("https://www.googleapis.com/auth/gmail.modify"),
      hasWriteback: scopes.includes("https://www.googleapis.com/auth/gmail.modify"),
    };
  },
  fetchGmailProfile: vi.fn(),
  exchangeServerAuthCode: vi.fn(),
  exchangeAuthCode: vi.fn(),
  encrypt: vi.fn(),
  GmailApiError: class GmailApiError extends Error {
    status: number;
    constructor(message: string, status = 400) {
      super(message);
      this.status = status;
    }
  },
}));

vi.mock("../queues.js", () => ({
  classifyThreadQueue: {
    getJobs: vi.fn().mockResolvedValue([]),
  },
  provisionLabelsQueue: { add: vi.fn().mockResolvedValue({}) },
}));

vi.mock("../services/queue-client.js", () => ({
  syncInboxQueue: {
    getDeduplicationJobId: vi.fn().mockResolvedValue(null),
    add: vi.fn().mockResolvedValue({}),
  },
  backfillInboxQueue: {
    getDeduplicationJobId: vi.fn().mockResolvedValue(null),
  },
}));

import app from "../app.js";
import { db } from "@amarnai/db";
import {
  revokeGoogleToken,
  GmailClient,
  fetchGmailProfile,
  exchangeServerAuthCode,
  exchangeAuthCode,
  GmailApiError,
  encrypt,
} from "@amarnai/gmail";
import { syncInboxQueue } from "../services/queue-client.js";
import { provisionLabelsQueue } from "../queues.js";
import { config } from "@amarnai/config";

const WS_ID = "ws-1";
const OTHER_WS_ID = "ws-other";

const baseConnection = {
  id: "conn-1",
  workspaceId: WS_ID,
  provider: "GMAIL" as const,
  emailAddress: "user@gmail.com",
  subjectId: null,
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
  vi.mocked(db.workspaceMember.findUnique).mockResolvedValue({
    userId: TEST_USER_ID,
    role: "OWNER",
  } as never);
  // Default: the requester owns the workspace, so the mount-level owner guard
  // (requireWorkspaceOwner) passes. Non-owner cases override this to null.
  vi.mocked(db.workspace.findFirst).mockResolvedValue({ id: WS_ID } as never);
  vi.mocked(db.emailConnection.update).mockResolvedValue({} as never);
  vi.mocked(db.emailConnection.count).mockResolvedValue(0); // no siblings by default
  vi.mocked(db.emailConnection.findMany).mockResolvedValue([]); // no visible siblings by default
  vi.mocked(db.emailAccount.findUnique).mockResolvedValue(baseEmailAccount as never);
  vi.mocked(db.emailAccount.update).mockResolvedValue({} as never);
  vi.mocked(db.emailThread.updateMany).mockResolvedValue({ count: 0 } as never);
  vi.mocked(db.auditLog.create).mockResolvedValue({} as never);
  mockStopWatch.mockResolvedValue(undefined);
  mockRevokeGoogleToken.mockResolvedValue(true);
  vi.mocked(fetchGmailProfile).mockResolvedValue({ emailAddress: "user@gmail.com" } as never);
  vi.mocked(exchangeServerAuthCode).mockResolvedValue({
    accessToken: "google-at",
    refreshToken: "google-rt",
    scope: `openid email ${GMAIL_SCOPE}`,
    expiresAt: new Date("2030-01-01T00:00:00.000Z"),
  });
  vi.mocked(exchangeAuthCode).mockResolvedValue({
    accessToken: "google-at",
    refreshToken: "google-rt",
    scope: `openid email ${GMAIL_SCOPE}`,
    expiresAt: new Date("2030-01-01T00:00:00.000Z"),
  });
  vi.mocked(encrypt).mockReturnValue("encrypted-token");
  vi.mocked(db.emailConnection.upsert).mockResolvedValue({} as never);
  vi.mocked(syncInboxQueue.add).mockResolvedValue({} as never);
});

// ─── GET /workspaces/:workspaceId/gmail-connection ─────────────────────────

describe("GET /workspaces/:workspaceId/gmail-connection", () => {
  it("returns the connection when one exists", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: WS_ID } as never);
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue(baseConnection as never);

    const res = await app.request(`/workspaces/${WS_ID}/gmail-connection`, authed());
    expect(res.status).toBe(200);
    const body = (await res.json()) as typeof baseConnection;
    expect(body).toMatchObject({ gmailAddress: "user@gmail.com", status: "ACTIVE" });
  });

  it("returns null when no connection exists", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: WS_ID } as never);
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue(null);

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
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue(withToken as never);

    const res = await app.request(`/workspaces/${WS_ID}/gmail-connection`, authed());
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty("encryptedRefreshToken");
  });

  it("reports an unshared mailbox when no other workspace syncs it", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: WS_ID } as never);
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue(baseConnection as never);

    const res = await app.request(`/workspaces/${WS_ID}/gmail-connection`, authed());
    const body = (await res.json()) as { sharedMailbox: boolean; alsoConnectedIn: unknown[] };
    expect(body.sharedMailbox).toBe(false);
    expect(body.alsoConnectedIn).toEqual([]);
  });

  it("reports sharedMailbox=true without leaking names when the sibling belongs to another tenant", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: WS_ID } as never);
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue(baseConnection as never);
    vi.mocked(db.emailConnection.count).mockResolvedValue(1); // foreign-tenant sibling
    vi.mocked(db.emailConnection.findMany).mockResolvedValue([]); // not visible to this user

    const res = await app.request(`/workspaces/${WS_ID}/gmail-connection`, authed());
    const body = (await res.json()) as { sharedMailbox: boolean; alsoConnectedIn: unknown[] };
    expect(body.sharedMailbox).toBe(true);
    expect(body.alsoConnectedIn).toEqual([]);
  });

  it("lists sibling workspaces the requesting user is a member of", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: WS_ID } as never);
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue(baseConnection as never);
    vi.mocked(db.emailConnection.count).mockResolvedValue(1);
    vi.mocked(db.emailConnection.findMany).mockResolvedValue([
      { workspace: { id: OTHER_WS_ID, name: "Benjamin Personal" } },
    ] as never);

    const res = await app.request(`/workspaces/${WS_ID}/gmail-connection`, authed());
    const body = (await res.json()) as { sharedMailbox: boolean; alsoConnectedIn: { id: string; name: string }[] };
    expect(body.sharedMailbox).toBe(true);
    expect(body.alsoConnectedIn).toEqual([{ id: OTHER_WS_ID, name: "Benjamin Personal" }]);
  });

  it("scopes the visible-siblings query to the requesting user's memberships", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: WS_ID } as never);
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue(baseConnection as never);

    await app.request(`/workspaces/${WS_ID}/gmail-connection`, authed());

    expect(vi.mocked(db.emailConnection.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspace: { members: { some: { userId: TEST_USER_ID } } },
        }),
      })
    );
  });

  it("only has the gmail.readonly scope in the granted scopes", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: WS_ID } as never);
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue(baseConnection as never);

    const res = await app.request(`/workspaces/${WS_ID}/gmail-connection`, authed());
    const body = (await res.json()) as typeof baseConnection;
    expect(body.grantedScopes).toEqual(["https://www.googleapis.com/auth/gmail.readonly"]);
  });
});

// ─── POST /workspaces/:workspaceId/gmail-connection ────────────────────────

const VALID_CONNECT_BODY = {
  serverAuthCode: "auth-code-123",
  scope: `openid email ${GMAIL_SCOPE}`,
};

// What connectionSelect returns — no encryptedRefreshToken.
const safeConnection = {
  id: "conn-1",
  workspaceId: WS_ID,
  provider: "GMAIL" as const,
  emailAddress: "user@gmail.com",
  grantedScopes: [GMAIL_SCOPE],
  status: "ACTIVE" as const,
  lastVerifiedAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

async function connect(body: unknown): Promise<Response> {
  return app.request(
    `/workspaces/${WS_ID}/gmail-connection`,
    authed({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

describe("POST /workspaces/:workspaceId/gmail-connection", () => {
  beforeEach(() => {
    vi.mocked(db.workspace.findFirst).mockResolvedValue({ id: WS_ID } as never); // requester owns the ws
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue(safeConnection as never);
  });

  it("stores the connection, enqueues one sync, and returns it (201)", async () => {
    const res = await connect(VALID_CONNECT_BODY);
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      gmailAddress: "user@gmail.com",
      status: "ACTIVE",
      sharedMailbox: false,
    });

    // The serverAuthCode is redeemed; the access token verifies the mailbox and
    // the resulting refresh token is encrypted.
    expect(vi.mocked(exchangeServerAuthCode)).toHaveBeenCalledWith("auth-code-123");
    expect(vi.mocked(fetchGmailProfile)).toHaveBeenCalledWith("google-at");
    expect(vi.mocked(encrypt)).toHaveBeenCalledWith("google-rt");
    expect(vi.mocked(db.emailConnection.upsert)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: WS_ID },
        create: expect.objectContaining({
          workspaceId: WS_ID,
          emailAddress: "user@gmail.com",
          encryptedRefreshToken: "encrypted-token",
          grantedScopes: ["openid", "email", GMAIL_SCOPE],
          status: "ACTIVE",
        }),
      })
    );
    expect(vi.mocked(syncInboxQueue.add)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(syncInboxQueue.add)).toHaveBeenCalledWith(
      "sync-inbox",
      { workspaceId: WS_ID },
      { deduplication: { id: `sync-inbox_${WS_ID}` } }
    );
  });

  it("redeems against the redirect URI when the extension supplies one", async () => {
    // The browser extension's code is minted for its chromiumapp.org redirect and
    // must be redeemed with exchangeAuthCode(code, redirectUri), not the redirect-
    // less server-auth path used by mobile.
    const res = await connect({
      ...VALID_CONNECT_BODY,
      redirectUri: "https://ext-id.chromiumapp.org/",
    });
    expect(res.status).toBe(201);
    expect(vi.mocked(exchangeAuthCode)).toHaveBeenCalledWith(
      "auth-code-123",
      "https://ext-id.chromiumapp.org/"
    );
    expect(vi.mocked(exchangeServerAuthCode)).not.toHaveBeenCalled();
    expect(vi.mocked(db.emailConnection.upsert)).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ status: "ACTIVE" }),
      })
    );
  });

  it("never returns the encrypted refresh token", async () => {
    const res = await connect(VALID_CONNECT_BODY);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty("encryptedRefreshToken");
    // The guarantee relies on the Prisma select excluding the field.
    expect(vi.mocked(db.emailConnection.findUnique)).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.not.objectContaining({ encryptedRefreshToken: true }),
      })
    );
  });

  it("rejects a non-owner with 403 and stores nothing", async () => {
    vi.mocked(db.workspaceMember.findUnique).mockResolvedValue({
      userId: TEST_USER_ID,
      role: "MEMBER",
    } as never);
    const res = await connect(VALID_CONNECT_BODY);
    expect(res.status).toBe(403);
    expect(vi.mocked(db.emailConnection.upsert)).not.toHaveBeenCalled();
    expect(vi.mocked(syncInboxQueue.add)).not.toHaveBeenCalled();
  });

  it("returns 403 and stores nothing when gmail.readonly was not granted", async () => {
    const res = await connect({ ...VALID_CONNECT_BODY, scope: "openid email" });
    expect(res.status).toBe(403);
    expect(vi.mocked(exchangeServerAuthCode)).not.toHaveBeenCalled();
    expect(vi.mocked(fetchGmailProfile)).not.toHaveBeenCalled();
    expect(vi.mocked(db.emailConnection.upsert)).not.toHaveBeenCalled();
    expect(vi.mocked(syncInboxQueue.add)).not.toHaveBeenCalled();
  });

  it("returns 502 and stores nothing when the serverAuthCode exchange fails", async () => {
    vi.mocked(exchangeServerAuthCode).mockRejectedValue(new GmailApiError("invalid_grant", 400));
    const res = await connect(VALID_CONNECT_BODY);
    expect(res.status).toBe(502);
    expect(vi.mocked(db.emailConnection.upsert)).not.toHaveBeenCalled();
    expect(vi.mocked(syncInboxQueue.add)).not.toHaveBeenCalled();
  });

  it("rejects a request missing the serverAuthCode with 400", async () => {
    const res = await connect({ scope: GMAIL_SCOPE });
    expect(res.status).toBe(400);
    expect(vi.mocked(exchangeServerAuthCode)).not.toHaveBeenCalled();
    expect(vi.mocked(db.emailConnection.upsert)).not.toHaveBeenCalled();
  });

  it("returns 409 and stores nothing when the workspace is connected to another provider", async () => {
    // A DISCONNECTED Outlook workspace must not be reactivated/clobbered by a
    // Gmail connect — the extension-sign-in resurrection bug. Reconnect via that
    // provider instead.
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue({
      ...safeConnection,
      provider: "OUTLOOK",
      status: "DISCONNECTED",
    } as never);

    const res = await connect(VALID_CONNECT_BODY);
    expect(res.status).toBe(409);
    expect(vi.mocked(db.emailConnection.upsert)).not.toHaveBeenCalled();
    expect(vi.mocked(syncInboxQueue.add)).not.toHaveBeenCalled();
  });

  it("enables writeback and provisions labels when the connect granted gmail.modify", async () => {
    // The web OAuth callback already did this; the extension's connect route did
    // not, so a granted write scope provisioned nothing.
    const original = config.mail.labelWritebackEnabled;
    (config.mail as { labelWritebackEnabled: boolean }).labelWritebackEnabled = true;
    try {
      vi.mocked(db.emailConnection.findUnique).mockResolvedValue({
        ...safeConnection,
        grantedScopes: [GMAIL_SCOPE, "https://www.googleapis.com/auth/gmail.modify"],
      } as never);

      const res = await connect(VALID_CONNECT_BODY);
      expect(res.status).toBe(201);
      expect(vi.mocked(provisionLabelsQueue.add)).toHaveBeenCalledWith(
        "provision-folder-labels",
        { workspaceId: WS_ID, relabelThreads: true },
        { deduplication: { id: `provision_relabel_${WS_ID}` } },
      );
    } finally {
      (config.mail as { labelWritebackEnabled: boolean }).labelWritebackEnabled = original;
    }
  });

  it("provisions nothing for a read-only connect", async () => {
    const original = config.mail.labelWritebackEnabled;
    (config.mail as { labelWritebackEnabled: boolean }).labelWritebackEnabled = true;
    try {
      const res = await connect(VALID_CONNECT_BODY);
      expect(res.status).toBe(201);
      expect(vi.mocked(provisionLabelsQueue.add)).not.toHaveBeenCalled();
    } finally {
      (config.mail as { labelWritebackEnabled: boolean }).labelWritebackEnabled = original;
    }
  });
});

// ─── DELETE /workspaces/:workspaceId/gmail-connection ─────────────────────

describe("DELETE /workspaces/:workspaceId/gmail-connection", () => {
  it("sets DISCONNECTED instead of deleting the row", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: WS_ID } as never);
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue(baseConnection as never);

    const res = await app.request(`/workspaces/${WS_ID}/gmail-connection`, authed({ method: "DELETE" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);

    expect(vi.mocked(db.emailConnection.update)).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "DISCONNECTED" }) })
    );
  });

  it("calls stopWatch before revokeGoogleToken", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: WS_ID } as never);
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue(baseConnection as never);

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
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue(baseConnection as never);
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
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue(baseConnection as never);
    mockRevokeGoogleToken.mockResolvedValue(false);

    const res = await app.request(`/workspaces/${WS_ID}/gmail-connection`, authed({ method: "DELETE" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; revoked: boolean };
    expect(body.ok).toBe(true);
    expect(body.revoked).toBe(false);
  });

  it("skips Google-side teardown and returns sharedMailbox=true when another workspace shares the mailbox", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: WS_ID } as never);
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue(baseConnection as never);
    vi.mocked(db.emailConnection.count).mockResolvedValue(1); // shared mailbox

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
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue(baseConnection as never);

    const res = await app.request(`/workspaces/${WS_ID}/gmail-connection`, authed({ method: "DELETE" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { erased: boolean };
    expect(body.erased).toBe(false);
    expect(vi.mocked(db.$transaction)).not.toHaveBeenCalled();
  });

  it("erases email data when ?eraseData=true", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: WS_ID } as never);
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue(baseConnection as never);
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
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue(baseConnection as never);

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
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue(disconnectedConn as never);

    const res = await app.request(`/workspaces/${WS_ID}/gmail-connection`, authed({ method: "DELETE" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("returns 404 when no connection exists", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: WS_ID } as never);
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue(null);

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
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue(null);

    const res = await app.request(`/workspaces/${WS_ID}/gmail-connection`, authed({ method: "DELETE" }));
    expect(res.status).toBe(404);
    expect(vi.mocked(db.emailConnection.update)).not.toHaveBeenCalled();
  });

  // Owner-only is enforced at the mount for the destructive disconnect route. A
  // member who is not the owner must not be able to disconnect (or eraseData).
  it("rejects a non-owner member with 403 and disconnects nothing (Gmail)", async () => {
    vi.mocked(db.workspaceMember.findUnique).mockResolvedValue({
      userId: TEST_USER_ID,
      role: "MEMBER",
    } as never);
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue(baseConnection as never);

    const res = await app.request(
      `/workspaces/${WS_ID}/gmail-connection?eraseData=true`,
      authed({ method: "DELETE" })
    );
    expect(res.status).toBe(403);
    expect(vi.mocked(db.emailConnection.update)).not.toHaveBeenCalled();
    expect(vi.mocked(db.$transaction)).not.toHaveBeenCalled();
  });

  // The single disconnect route tears down OUTLOOK connections too (disconnectGmail
  // is provider-neutral), so the owner guard must protect Outlook mailboxes as well.
  it("rejects a non-owner member with 403 and disconnects nothing (Outlook)", async () => {
    vi.mocked(db.workspaceMember.findUnique).mockResolvedValue({
      userId: TEST_USER_ID,
      role: "MEMBER",
    } as never);
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue({
      ...baseConnection,
      provider: "OUTLOOK",
      emailAddress: "user@outlook.com",
    } as never);

    const res = await app.request(
      `/workspaces/${WS_ID}/gmail-connection?eraseData=true`,
      authed({ method: "DELETE" })
    );
    expect(res.status).toBe(403);
    expect(vi.mocked(db.emailConnection.update)).not.toHaveBeenCalled();
    expect(vi.mocked(db.$transaction)).not.toHaveBeenCalled();
  });

  it("allows the owner to disconnect an OUTLOOK connection through the shared route", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: WS_ID } as never);
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue({
      ...baseConnection,
      provider: "OUTLOOK",
      emailAddress: "user@outlook.com",
    } as never);

    const res = await app.request(`/workspaces/${WS_ID}/gmail-connection`, authed({ method: "DELETE" }));
    expect(res.status).toBe(200);
    expect(vi.mocked(db.emailConnection.update)).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "DISCONNECTED" }) })
    );
  });
});

// ─── One connection per workspace enforcement ──────────────────────────────

describe("One GmailConnection per workspace", () => {
  it("GET returns the single connection for a workspace", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: WS_ID } as never);
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue(baseConnection as never);

    const res1 = await app.request(`/workspaces/${WS_ID}/gmail-connection`, authed());
    expect(res1.status).toBe(200);

    // A different workspace has no connection
    vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: OTHER_WS_ID } as never);
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue(null);

    const res2 = await app.request(`/workspaces/${OTHER_WS_ID}/gmail-connection`, authed());
    expect(res2.status).toBe(200);
    expect(await res2.json()).toBeNull();
  });
});

describe("owner guard — one definition of owner", () => {
  it("authorizes on the membership role, not Workspace.ownerUserId", async () => {
    // The two are separate columns answering different questions. Every other
    // owner-only path (workspace update, billing, taxonomy) reads the role, so
    // this one does too; a user holding ownerUserId without an OWNER member row
    // is not an owner for authorization purposes.
    vi.mocked(db.workspaceMember.findUnique).mockResolvedValue({
      userId: TEST_USER_ID,
      role: "MEMBER",
    } as never);
    vi.mocked(db.workspace.findFirst).mockResolvedValue({ id: WS_ID } as never);

    const res = await app.request(
      `/workspaces/${WS_ID}/gmail-connection`,
      authed({ method: "DELETE" }),
    );

    expect(res.status).toBe(403);
  });

  it("hides the workspace entirely from someone with no membership", async () => {
    vi.mocked(db.workspaceMember.findUnique).mockResolvedValue(null as never);

    const res = await app.request(
      `/workspaces/${WS_ID}/gmail-connection`,
      authed({ method: "DELETE" }),
    );

    // 404 rather than 403: the membership guard runs first and declines to
    // confirm the workspace exists to a stranger. Only a member who is not an
    // owner gets the 403 above.
    expect(res.status).toBe(404);
  });
});
