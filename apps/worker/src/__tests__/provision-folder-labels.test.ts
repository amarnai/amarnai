import { vi, describe, it, expect, beforeEach } from "vitest";

// Uses the REAL @amarnai/core path builder + folder-color resolver, mocking only
// the DB and the mail adapter, so the node→path→label wiring is exercised end to end.

const { mockEnsure } = vi.hoisted(() => ({ mockEnsure: vi.fn() }));

vi.mock("@amarnai/config", () => ({ config: { mail: { labelWritebackEnabled: true } } }));

vi.mock("@amarnai/db", () => ({
  db: {
    gmailSyncSettings: { findUnique: vi.fn() },
    emailConnection: { findUnique: vi.fn() },
    taxonomyNode: { findMany: vi.fn() },
    taxonomyEdge: { findMany: vi.fn() },
    taxonomyNodeProviderLink: { findMany: vi.fn(), deleteMany: vi.fn(), upsert: vi.fn() },
  },
  markGmailConnectionAuthFailed: vi.fn(),
}));

vi.mock("@amarnai/mail", () => ({
  createMailProvider: vi.fn(() => ({ ensureFolderLabels: mockEnsure })),
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
}));

import { db } from "@amarnai/db";
import { loadWritebackConnection, provisionFolderLabels } from "../jobs/provision-folder-labels.js";

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
});

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
    const conn = await loadWritebackConnection(WS);
    expect(conn?.mailboxKey).toBe("user@example.com");
  });

  it("returns the mailbox-keyed connection when active + scoped", async () => {
    vi.mocked(db.gmailSyncSettings.findUnique).mockResolvedValue({ labelWritebackEnabled: true } as never);
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue(ACTIVE_ROW as never);
    const conn = await loadWritebackConnection(WS);
    expect(conn?.mailboxKey).toBe("user@example.com");
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
    expect(byNode.get("clients")).toEqual(["Amarnai", "Clients"]);
    expect(byNode.get("acme")).toEqual(["Amarnai", "Clients", "Acme"]);
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

  it("skips nodes already provisioned at their current path", async () => {
    vi.mocked(db.taxonomyNode.findMany).mockResolvedValue([
      { id: "root", name: "Root", isRoot: true, isCatchAll: false, colorKey: null },
      { id: "clients", name: "Clients", isRoot: false, isCatchAll: false, colorKey: null },
    ] as never);
    vi.mocked(db.taxonomyEdge.findMany).mockResolvedValue([
      { id: "e1", sourceNodeId: "root", targetNodeId: "clients", createdAt: new Date(1) },
    ] as never);
    // Existing link already at "Amarnai/Clients" → nothing to (re)create.
    vi.mocked(db.taxonomyNodeProviderLink.findMany).mockResolvedValue([
      { nodeId: "clients", providerPath: "Amarnai/Clients" },
    ] as never);

    const count = await provisionFolderLabels(WS, CONNECTION);

    expect(count).toBe(0);
    expect(mockEnsure).not.toHaveBeenCalled();
  });
});
