import { vi, describe, it, expect, beforeEach } from "vitest";

// Uses the REAL @aziru/core path builder + folder-color resolver, mocking only
// the DB and the mail adapter, so the node→path→label wiring is exercised end to end.

const { mockEnsure, mockRename } = vi.hoisted(() => ({ mockEnsure: vi.fn(), mockRename: vi.fn() }));

vi.mock("@aziru/config", () => ({ config: { mail: { labelWritebackEnabled: true } } }));

vi.mock("@aziru/db", () => ({
  db: {
    gmailSyncSettings: { findUnique: vi.fn() },
    emailConnection: { findUnique: vi.fn() },
    taxonomyNode: { findMany: vi.fn() },
    taxonomyEdge: { findMany: vi.fn() },
    taxonomyNodeProviderLink: { findMany: vi.fn(), deleteMany: vi.fn(), upsert: vi.fn() },
    emailClassification: { findMany: vi.fn() },
  },
  markGmailConnectionAuthFailed: vi.fn(),
}));

vi.mock("@aziru/mail", () => ({
  createMailProvider: vi.fn(() => ({ ensureFolderLabels: mockEnsure, renameFolderLabel: mockRename })),
  MailAuthError: class MailAuthError extends Error {},
  providerHasWritebackScope: vi.fn(() => true),
}));

vi.mock("bullmq", () => ({
  Worker: vi.fn().mockImplementation((_q: string, processor: unknown) => ({ _processor: processor, on: vi.fn() })),
}));
vi.mock("../redis.js", () => ({ redisConnection: {} }));
vi.mock("../queues.js", () => ({
  QUEUE_PROVISION_LABELS: "provision-folder-labels",
  pushNotificationQueue: { add: vi.fn().mockResolvedValue(undefined) },
  writebackThreadLabelQueue: { addBulk: vi.fn().mockResolvedValue([]) },
}));

import { db } from "@aziru/db";
import { Worker } from "bullmq";
import { writebackThreadLabelQueue } from "../queues.js";
import {
  loadWritebackConnection,
  provisionFolderLabels,
  createProvisionFolderLabelsWorker,
} from "../jobs/provision-folder-labels.js";

const WS = "ws-1";
const CONNECTION = {
  provider: "GMAIL" as const,
  encryptedRefreshToken: "enc",
  grantedScopes: ["https://www.googleapis.com/auth/gmail.modify"],
  mailboxKey: "user@example.com",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.taxonomyNodeProviderLink.deleteMany).mockResolvedValue({ count: 0 } as never);
  vi.mocked(db.taxonomyNodeProviderLink.upsert).mockResolvedValue({} as never);
  vi.mocked(db.taxonomyNodeProviderLink.findMany).mockResolvedValue([] as never);
  vi.mocked(db.emailClassification.findMany).mockResolvedValue([] as never);
  mockEnsure.mockResolvedValue(new Map());
  mockRename.mockResolvedValue(undefined);
});

function getProcessor(): (job: unknown) => Promise<void> {
  const WorkerMock = vi.mocked(Worker);
  const lastCall = WorkerMock.mock.calls[WorkerMock.mock.calls.length - 1];
  return lastCall?.[1] as (job: unknown) => Promise<void>;
}

/** A routable taxonomy: root + 3 reachable folders (the writeback threshold). */
function primeRoutableTaxonomy() {
  vi.mocked(db.taxonomyNode.findMany).mockResolvedValue([
    { id: "root", name: "Root", isRoot: true, isCatchAll: false, colorKey: null },
    { id: "a", name: "A", isRoot: false, isCatchAll: false, colorKey: null },
    { id: "b", name: "B", isRoot: false, isCatchAll: false, colorKey: null },
    { id: "c", name: "C", isRoot: false, isCatchAll: false, colorKey: null },
  ] as never);
  vi.mocked(db.taxonomyEdge.findMany).mockResolvedValue([
    { id: "e1", sourceNodeId: "root", targetNodeId: "a", createdAt: new Date(1) },
    { id: "e2", sourceNodeId: "root", targetNodeId: "b", createdAt: new Date(2) },
    { id: "e3", sourceNodeId: "root", targetNodeId: "c", createdAt: new Date(3) },
  ] as never);
}

/** Minimal happy-path db state: an active scoped connection, routable taxonomy. */
function primeActiveConnection() {
  vi.mocked(db.gmailSyncSettings.findUnique).mockResolvedValue({ labelWritebackEnabled: true } as never);
  vi.mocked(db.emailConnection.findUnique).mockResolvedValue({
    provider: "GMAIL",
    status: "ACTIVE",
    grantedScopes: CONNECTION.grantedScopes,
    encryptedRefreshToken: "enc",
    emailAddress: "user@example.com",
    subjectId: null,
  } as never);
  primeRoutableTaxonomy();
}

describe("loadWritebackConnection", () => {
  const ACTIVE_ROW = {
    provider: "GMAIL",
    status: "ACTIVE",
    grantedScopes: CONNECTION.grantedScopes,
    encryptedRefreshToken: "enc",
    emailAddress: "user@example.com",
    subjectId: null,
  };

  it("returns null when the workspace explicitly switched writeback off", async () => {
    vi.mocked(db.gmailSyncSettings.findUnique).mockResolvedValue({ labelWritebackEnabled: false } as never);
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue(ACTIVE_ROW as never);
    expect(await loadWritebackConnection(WS)).toBeNull();
  });

  it("treats a MISSING settings row as the on-by-default state", async () => {
    vi.mocked(db.gmailSyncSettings.findUnique).mockResolvedValue(null as never);
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue(ACTIVE_ROW as never);
    primeRoutableTaxonomy();
    const conn = await loadWritebackConnection(WS);
    expect(conn?.mailboxKey).toBe("user@example.com");
  });

  it("returns the mailbox-keyed connection when active + scoped + routable", async () => {
    vi.mocked(db.gmailSyncSettings.findUnique).mockResolvedValue({ labelWritebackEnabled: true } as never);
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue(ACTIVE_ROW as never);
    primeRoutableTaxonomy();
    const conn = await loadWritebackConnection(WS);
    expect(conn?.mailboxKey).toBe("user@example.com");
  });

  it("returns null when the taxonomy is not routable (no plan ⇒ no mailbox writes)", async () => {
    // The seeded state every new workspace starts in: root + catch-all only.
    // The catch-all is excluded from the routable count, so nothing may be
    // mirrored into the mailbox — no labels at sign-in, no relabel sweep.
    vi.mocked(db.gmailSyncSettings.findUnique).mockResolvedValue({ labelWritebackEnabled: true } as never);
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue(ACTIVE_ROW as never);
    vi.mocked(db.taxonomyNode.findMany).mockResolvedValue([
      { id: "root", name: "Inbox", isRoot: true, isCatchAll: false, colorKey: null },
      { id: "other", name: "Updates / Other", isRoot: false, isCatchAll: true, colorKey: null },
    ] as never);
    vi.mocked(db.taxonomyEdge.findMany).mockResolvedValue([
      { id: "e1", sourceNodeId: "root", targetNodeId: "other", createdAt: new Date(1) },
    ] as never);
    expect(await loadWritebackConnection(WS)).toBeNull();
  });
});

describe("provisionFolderLabels", () => {
  it("builds nested paths, provisions non-root folders, and upserts links", async () => {
    // Root → Clients → Acme. Only the two non-root nodes get labels.
    vi.mocked(db.taxonomyNode.findMany).mockResolvedValue([
      { id: "root", name: "Root", isRoot: true, isCatchAll: false, colorKey: null },
      { id: "clients", name: "Clients", isRoot: false, isCatchAll: false, colorKey: "blue" },
      { id: "acme", name: "Acme", isRoot: false, isCatchAll: false, colorKey: null },
    ] as never);
    vi.mocked(db.taxonomyEdge.findMany).mockResolvedValue([
      { id: "e1", sourceNodeId: "root", targetNodeId: "clients", createdAt: new Date(1) },
      { id: "e2", sourceNodeId: "clients", targetNodeId: "acme", createdAt: new Date(2) },
    ] as never);
    mockEnsure.mockResolvedValue(new Map([["clients", "L_clients"], ["acme", "L_acme"]]));

    const count = await provisionFolderLabels(WS, CONNECTION);

    expect(count).toBe(2);
    // ensureFolderLabels received the namespaced, nested paths for non-root nodes.
    const defs = mockEnsure.mock.calls[0]![0] as Array<{ nodeId: string; pathSegments: string[] }>;
    const byNode = new Map(defs.map((d) => [d.nodeId, d.pathSegments]));
    expect(byNode.get("clients")).toEqual(["Aziru", "Clients"]);
    expect(byNode.get("acme")).toEqual(["Aziru", "Clients", "Acme"]);
    expect(byNode.has("root")).toBe(false);
    // A link row is upserted per provisioned node.
    expect(db.taxonomyNodeProviderLink.upsert).toHaveBeenCalledTimes(2);
  });

  it("deletes links belonging to a rotated-out mailbox before provisioning", async () => {
    vi.mocked(db.taxonomyNode.findMany).mockResolvedValue([] as never);
    vi.mocked(db.taxonomyEdge.findMany).mockResolvedValue([] as never);

    await provisionFolderLabels(WS, CONNECTION);

    expect(db.taxonomyNodeProviderLink.deleteMany).toHaveBeenCalledWith({
      where: { workspaceId: WS, provider: "GMAIL", NOT: { mailboxKey: CONNECTION.mailboxKey } },
    });
  });

  it("re-verifies against the provider even when links exist (self-heal after external deletion)", async () => {
    // A link row saying "already provisioned" must NOT short-circuit the run:
    // the user may have deleted the label in Gmail, and only the adapter's
    // fresh list knows. The adapter reuses what exists and recreates the rest;
    // the link is refreshed with whatever id came back.
    vi.mocked(db.taxonomyNode.findMany).mockResolvedValue([
      { id: "root", name: "Root", isRoot: true, isCatchAll: false, colorKey: null },
      { id: "clients", name: "Clients", isRoot: false, isCatchAll: false, colorKey: null },
    ] as never);
    vi.mocked(db.taxonomyEdge.findMany).mockResolvedValue([
      { id: "e1", sourceNodeId: "root", targetNodeId: "clients", createdAt: new Date(1) },
    ] as never);
    vi.mocked(db.taxonomyNodeProviderLink.findMany).mockResolvedValue([
      { nodeId: "clients", providerPath: "Aziru/Clients" },
    ] as never);
    // Label was deleted in Gmail; the adapter recreates it under a fresh id.
    mockEnsure.mockResolvedValue(new Map([["clients", "L_clients_v2"]]));

    const count = await provisionFolderLabels(WS, CONNECTION);

    expect(count).toBe(1);
    expect(mockEnsure).toHaveBeenCalledTimes(1);
    expect(db.taxonomyNodeProviderLink.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ providerLabelId: "L_clients_v2" }),
      }),
    );
  });

  it("renames a drifted label in place before ensuring (path changed, id kept)", async () => {
    // The stored link carries the pre-rename namespace; the computed path is
    // the new one. The provider must be asked to rename the EXISTING label id
    // so threads already carrying it follow, and no duplicate is created.
    vi.mocked(db.taxonomyNode.findMany).mockResolvedValue([
      { id: "root", name: "Root", isRoot: true, isCatchAll: false, colorKey: null },
      { id: "clients", name: "Clients", isRoot: false, isCatchAll: false, colorKey: null },
    ] as never);
    vi.mocked(db.taxonomyEdge.findMany).mockResolvedValue([
      { id: "e1", sourceNodeId: "root", targetNodeId: "clients", createdAt: new Date(1) },
    ] as never);
    vi.mocked(db.taxonomyNodeProviderLink.findMany).mockResolvedValue([
      { nodeId: "clients", providerLabelId: "L_old", providerPath: "Amarnai/Clients" },
    ] as never);
    mockEnsure.mockResolvedValue(new Map([["clients", "L_old"]]));

    await provisionFolderLabels(WS, CONNECTION);

    expect(mockRename).toHaveBeenCalledWith("L_old", ["Aziru", "Clients"]);
    // Rename runs before ensure so ensure resolves the new name to the same id.
    expect(mockRename.mock.invocationCallOrder[0]!).toBeLessThan(
      mockEnsure.mock.invocationCallOrder[0]!,
    );
    expect(db.taxonomyNodeProviderLink.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ providerLabelId: "L_old", providerPath: "Aziru/Clients" }),
      }),
    );
  });

  it("does not rename when the stored path already matches", async () => {
    vi.mocked(db.taxonomyNode.findMany).mockResolvedValue([
      { id: "root", name: "Root", isRoot: true, isCatchAll: false, colorKey: null },
      { id: "clients", name: "Clients", isRoot: false, isCatchAll: false, colorKey: null },
    ] as never);
    vi.mocked(db.taxonomyEdge.findMany).mockResolvedValue([
      { id: "e1", sourceNodeId: "root", targetNodeId: "clients", createdAt: new Date(1) },
    ] as never);
    vi.mocked(db.taxonomyNodeProviderLink.findMany).mockResolvedValue([
      { nodeId: "clients", providerLabelId: "L_clients", providerPath: "Aziru/Clients" },
    ] as never);
    mockEnsure.mockResolvedValue(new Map([["clients", "L_clients"]]));

    await provisionFolderLabels(WS, CONNECTION);

    expect(mockRename).not.toHaveBeenCalled();
  });
});

describe("provision worker — relabelThreads fan-out", () => {
  it("enqueues a deduped writeback job per classified thread when relabelThreads is set", async () => {
    primeActiveConnection();
    vi.mocked(db.emailClassification.findMany).mockResolvedValue([
      { emailThreadId: "t1" },
      { emailThreadId: "t2" },
    ] as never);

    createProvisionFolderLabelsWorker();
    await getProcessor()({ data: { workspaceId: WS, relabelThreads: true } });

    const [jobs] = vi.mocked(writebackThreadLabelQueue.addBulk).mock.calls[0]! as [
      Array<{ data: { emailThreadId: string }; opts: { deduplication: { id: string } } }>,
    ];
    expect(jobs.map((j) => j.data.emailThreadId)).toEqual(["t1", "t2"]);
    expect(jobs[0]!.opts.deduplication.id).toBe(`writeback_${WS}_t1`);
    // Distinct thread ids come from the classification query, latest-wins is the
    // per-thread job's concern.
    expect(db.emailClassification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ distinct: ["emailThreadId"] }),
    );
  });

  it("does NOT sweep threads on a structural-only provision run", async () => {
    primeActiveConnection();
    createProvisionFolderLabelsWorker();
    await getProcessor()({ data: { workspaceId: WS } });

    expect(writebackThreadLabelQueue.addBulk).not.toHaveBeenCalled();
    expect(db.emailClassification.findMany).not.toHaveBeenCalled();
  });
});
