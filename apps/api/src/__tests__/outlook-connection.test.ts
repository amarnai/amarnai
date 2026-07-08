import { vi, describe, it, expect, beforeEach } from "vitest";
import { authed, TEST_USER_ID } from "./helpers.js";

// config.outlook.enabled is derived from these at module init, so they must be
// set before the app (and @amarnai/config) is imported. vi.hoisted runs first.
vi.hoisted(() => {
  process.env["MS_GRAPH_CLIENT_ID"] = "ms-client-id";
  process.env["MS_GRAPH_CLIENT_SECRET"] = "ms-client-secret";
});

vi.mock("@amarnai/db", () => {
  const db = {
    workspace: { findFirst: vi.fn(), findUnique: vi.fn() },
    workspaceMember: { findUnique: vi.fn() },
    emailConnection: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
      count: vi.fn(),
    },
    auditLog: { create: vi.fn() },
  };
  return {
    db,
    deleteGmailDisconnectedNotifications: vi.fn().mockResolvedValue(undefined),
    eraseStaleEmailAccounts: vi.fn().mockResolvedValue([]),
    maybeCreateExtensionNudge: vi.fn().mockResolvedValue(undefined),
  };
});

const OUTLOOK_SCOPE = "Mail.Read";

// Stub only the network calls; keep GraphClient/parseGrantedScopes/MicrosoftApiError
// real so @amarnai/mail's provider-conformance import still resolves. The real
// storeOutlookConnection runs against the db mock (its fetchOutlookProfile stubbed).
vi.mock("@amarnai/outlook", async (importActual) => {
  const actual = await importActual<typeof import("@amarnai/outlook")>();
  return {
    ...actual,
    exchangeAuthCode: vi.fn(),
    fetchOutlookProfile: vi.fn(),
  };
});

vi.mock("../services/queue-client.js", () => ({
  syncInboxQueue: { add: vi.fn().mockResolvedValue({}) },
  backfillInboxQueue: { getDeduplicationJobId: vi.fn().mockResolvedValue(null) },
}));

vi.mock("../services/outlook-subscription.js", () => ({
  registerOutlookSubscription: vi.fn().mockResolvedValue({ ok: true }),
}));

import app from "../app.js";
import { db } from "@amarnai/db";
import { exchangeAuthCode, fetchOutlookProfile, MicrosoftApiError } from "@amarnai/outlook";
import { syncInboxQueue } from "../services/queue-client.js";

const WS_ID = "ws-1";

const VALID_BODY = {
  code: "ms-auth-code",
  scope: OUTLOOK_SCOPE,
  redirectUri: "https://ext-id.chromiumapp.org/",
};

// What connectionSelect returns for the final response (no refresh token).
const safeConnection = {
  id: "conn-1",
  workspaceId: WS_ID,
  provider: "OUTLOOK" as const,
  emailAddress: "user@outlook.com",
  grantedScopes: [OUTLOOK_SCOPE],
  status: "ACTIVE" as const,
  lastVerifiedAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

async function connect(body: unknown): Promise<Response> {
  return app.request(
    `/workspaces/${WS_ID}/outlook-connection`,
    authed({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.workspaceMember.findUnique).mockResolvedValue({ userId: TEST_USER_ID } as never);
  vi.mocked(db.workspace.findFirst).mockResolvedValue({ id: WS_ID } as never); // requester owns the ws
  vi.mocked(db.emailConnection.findUnique).mockResolvedValue(safeConnection as never);
  vi.mocked(db.emailConnection.count).mockResolvedValue(0);
  vi.mocked(db.emailConnection.findMany).mockResolvedValue([]);
  vi.mocked(db.emailConnection.upsert).mockResolvedValue({} as never);
  vi.mocked(db.auditLog.create).mockResolvedValue({} as never);
  vi.mocked(fetchOutlookProfile).mockResolvedValue({
    emailAddress: "user@outlook.com",
    subjectId: "entra-id",
  } as never);
  vi.mocked(exchangeAuthCode).mockResolvedValue({
    accessToken: "graph-at",
    refreshToken: "graph-rt",
    scope: OUTLOOK_SCOPE,
    expiresAt: new Date("2030-01-01T00:00:00.000Z"),
  } as never);
});

describe("POST /workspaces/:workspaceId/outlook-connection", () => {
  it("redeems the code against the redirect URI, stores an OUTLOOK connection, and syncs (201)", async () => {
    // First findUnique is priorConnection; storeOutlookConnection's guard sees
    // the existing OUTLOOK row; the final findUnique returns the response shape.
    const res = await connect(VALID_BODY);
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ gmailAddress: "user@outlook.com", status: "ACTIVE", provider: "OUTLOOK" });

    expect(vi.mocked(exchangeAuthCode)).toHaveBeenCalledWith(
      "ms-auth-code",
      "https://ext-id.chromiumapp.org/",
    );
    expect(vi.mocked(db.emailConnection.upsert)).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ provider: "OUTLOOK", status: "ACTIVE" }),
      }),
    );
    expect(vi.mocked(syncInboxQueue.add)).toHaveBeenCalledTimes(1);
  });

  it("rejects a non-owner with 403 and stores nothing", async () => {
    vi.mocked(db.workspace.findFirst).mockResolvedValue(null); // not the owner
    const res = await connect(VALID_BODY);
    expect(res.status).toBe(403);
    expect(vi.mocked(db.emailConnection.upsert)).not.toHaveBeenCalled();
  });

  it("returns 403 and stores nothing when Mail.Read was not granted", async () => {
    const res = await connect({ ...VALID_BODY, scope: "User.Read offline_access" });
    expect(res.status).toBe(403);
    expect(vi.mocked(exchangeAuthCode)).not.toHaveBeenCalled();
    expect(vi.mocked(db.emailConnection.upsert)).not.toHaveBeenCalled();
  });

  it("returns 409 when the workspace is connected to Gmail", async () => {
    // priorConnection + the guard both read this: a Gmail row must not be
    // clobbered by an Outlook connect.
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue({
      ...safeConnection,
      provider: "GMAIL",
    } as never);
    const res = await connect(VALID_BODY);
    expect(res.status).toBe(409);
    expect(vi.mocked(db.emailConnection.upsert)).not.toHaveBeenCalled();
    expect(vi.mocked(syncInboxQueue.add)).not.toHaveBeenCalled();
  });

  it("returns 502 and stores nothing when the code exchange fails", async () => {
    vi.mocked(exchangeAuthCode).mockRejectedValue(new MicrosoftApiError("invalid_grant", 400));
    const res = await connect(VALID_BODY);
    expect(res.status).toBe(502);
    expect(vi.mocked(db.emailConnection.upsert)).not.toHaveBeenCalled();
    expect(vi.mocked(syncInboxQueue.add)).not.toHaveBeenCalled();
  });

  it("rejects a request missing the redirectUri with 400", async () => {
    const res = await connect({ code: "x", scope: OUTLOOK_SCOPE });
    expect(res.status).toBe(400);
    expect(vi.mocked(exchangeAuthCode)).not.toHaveBeenCalled();
  });
});
