import { vi, describe, it, expect, beforeEach } from "vitest";
import { authed, TEST_USER_ID } from "./helpers.js";

vi.mock("@amarnai/db", () => ({
  db: {
    workspaceMember: { findUnique: vi.fn() },
    workspace: { findUnique: vi.fn() },
    gmailConnection: { findUnique: vi.fn() },
    emailAccount: { findUnique: vi.fn() },
    providerSyncState: { findUnique: vi.fn() },
    gmailSyncSettings: { findUnique: vi.fn() },
    taxonomyNode: { findMany: vi.fn() },
    taxonomyEdge: { findMany: vi.fn() },
  },
}));

import app from "../app.js";
import { db } from "@amarnai/db";

const WS = "ws-1";

type SyncStatusBody = {
  backfillStatus: string;
  backfillLoadedThreads: number;
  backfillTotalThreads: number;
  backfillAwaitingTaxonomy: boolean;
  backfillRoutingStarted: boolean;
};

function get() {
  return app.request(`/workspaces/${WS}/sync-status`, authed());
}

async function getBody(): Promise<SyncStatusBody> {
  return (await get()).json() as Promise<SyncStatusBody>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.workspaceMember.findUnique).mockResolvedValue({ userId: TEST_USER_ID } as never);
  vi.mocked(db.gmailConnection.findUnique).mockResolvedValue({
    googleSubjectId: "sub-1",
    gmailAddress: "a@gmail.com",
    gmailWatchExpiresAt: new Date(Date.now() + 60_000),
  } as never);
  vi.mocked(db.emailAccount.findUnique).mockResolvedValue({ id: "account-1" } as never);
  vi.mocked(db.gmailSyncSettings.findUnique).mockResolvedValue({ sortingPaused: false } as never);
  vi.mocked(db.workspace.findUnique).mockResolvedValue({ plan: "PRO" } as never);
  // A routable taxonomy (3 non-root nodes linked to root) by default.
  vi.mocked(db.taxonomyNode.findMany).mockResolvedValue([
    { id: "root", isRoot: true, isCatchAll: false },
    { id: "n1", isRoot: false, isCatchAll: false },
    { id: "n2", isRoot: false, isCatchAll: false },
    { id: "n3", isRoot: false, isCatchAll: false },
  ] as never);
  vi.mocked(db.taxonomyEdge.findMany).mockResolvedValue([
    { sourceNodeId: "root", targetNodeId: "n1" },
    { sourceNodeId: "root", targetNodeId: "n2" },
    { sourceNodeId: "root", targetNodeId: "n3" },
  ] as never);
});

describe("GET /workspaces/:workspaceId/sync-status", () => {
  it("reports backfill state while running", async () => {
    vi.mocked(db.providerSyncState.findUnique).mockResolvedValue({
      status: "OK",
      lastSyncedAt: null,
      errorMessage: null,
      backfillStatus: "RUNNING",
      backfillSkipped: 0,
      backfillCompletedAt: null,
      backfillCapReached: false,
      backfillBeyondCount: 0,
      backfillProcessedCount: 120,
    } as never);

    const res = await get();
    expect(res.status).toBe(200);
    const body = (await res.json()) as SyncStatusBody;
    expect(body.backfillStatus).toBe("RUNNING");
    expect(body.backfillLoadedThreads).toBe(120);
    // The card is count-less; no reliable total exists, so there is no denominator.
    expect(body.backfillTotalThreads).toBe(0);
    expect(body.backfillAwaitingTaxonomy).toBe(false);
    // No boundary stamped yet → the user has not started backfill routing.
    expect(body.backfillRoutingStarted).toBe(false);
  });

  it("reports backfillRoutingStarted once the boundary is stamped", async () => {
    vi.mocked(db.providerSyncState.findUnique).mockResolvedValue({
      status: "OK",
      lastSyncedAt: null,
      errorMessage: null,
      backfillStatus: "RUNNING",
      backfillSkipped: 0,
      backfillCompletedAt: null,
      backfillCapReached: false,
      backfillBeyondCount: 0,
      backfillProcessedCount: 50,
      backfillRoutingStartedAt: new Date(),
    } as never);

    const body = await getBody();
    expect(body.backfillRoutingStarted).toBe(true);
  });

  it("flags awaiting-taxonomy while running with an unroutable taxonomy", async () => {
    vi.mocked(db.taxonomyNode.findMany).mockResolvedValue([{ id: "root", isRoot: true, isCatchAll: false }] as never);
    vi.mocked(db.taxonomyEdge.findMany).mockResolvedValue([] as never);
    vi.mocked(db.providerSyncState.findUnique).mockResolvedValue({
      status: "OK",
      lastSyncedAt: null,
      errorMessage: null,
      backfillStatus: "RUNNING",
      backfillSkipped: 0,
      backfillCompletedAt: null,
      backfillCapReached: false,
      backfillBeyondCount: 0,
      backfillProcessedCount: 10,
    } as never);

    const body = await getBody();
    expect(body.backfillAwaitingTaxonomy).toBe(true);
  });

  it("zeroes the progress fields when no backfill is running", async () => {
    vi.mocked(db.providerSyncState.findUnique).mockResolvedValue({
      status: "OK",
      lastSyncedAt: null,
      errorMessage: null,
      backfillStatus: "DONE",
      backfillSkipped: 0,
      backfillCompletedAt: new Date(),
      backfillCapReached: false,
      backfillBeyondCount: 0,
      backfillProcessedCount: 300,
    } as never);

    const body = await getBody();
    expect(body.backfillStatus).toBe("DONE");
    expect(body.backfillLoadedThreads).toBe(0);
    expect(body.backfillTotalThreads).toBe(0);
  });

  it("returns null when there is no sync state yet", async () => {
    vi.mocked(db.providerSyncState.findUnique).mockResolvedValue(null as never);
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });
});
