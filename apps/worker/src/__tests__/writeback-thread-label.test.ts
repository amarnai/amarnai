import { vi, describe, it, expect, beforeEach } from "vitest";

// Error classes + mocks must be hoisted so the (hoisted) vi.mock factories below
// can reference them without a temporal-dead-zone error.
const { MailAuthError, MailThreadNotFoundError, UnrecoverableError, mockApply, mockLoadConnection, mockProvision } =
  vi.hoisted(() => ({
    MailAuthError: class MailAuthError extends Error {},
    MailThreadNotFoundError: class MailThreadNotFoundError extends Error {},
    UnrecoverableError: class UnrecoverableError extends Error {},
    mockApply: vi.fn(),
    mockLoadConnection: vi.fn(),
    mockProvision: vi.fn(),
  }));

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@amarnai/db", () => ({
  db: {
    emailThread: { findFirst: vi.fn() },
    emailMessage: { findMany: vi.fn() },
    emailClassification: { findFirst: vi.fn() },
    taxonomyNodeProviderLink: { findMany: vi.fn(), findUnique: vi.fn() },
  },
  markGmailConnectionAuthFailed: vi.fn(),
}));

vi.mock("@amarnai/mail", () => ({
  createMailProvider: vi.fn(() => ({ applyThreadFolderLabels: mockApply })),
  MailAuthError,
  MailThreadNotFoundError,
}));

vi.mock("../jobs/provision-folder-labels.js", () => ({
  loadWritebackConnection: mockLoadConnection,
  provisionFolderLabels: mockProvision,
}));

vi.mock("bullmq", () => ({
  Worker: vi.fn().mockImplementation((_q: string, processor: unknown) => ({ _processor: processor, on: vi.fn() })),
  UnrecoverableError,
}));

vi.mock("../redis.js", () => ({ redisConnection: {} }));
vi.mock("../queues.js", () => ({
  QUEUE_WRITEBACK_THREAD_LABEL: "writeback-thread-label",
  pushNotificationQueue: { add: vi.fn().mockResolvedValue(undefined) },
}));

import { db, markGmailConnectionAuthFailed } from "@amarnai/db";
import { Worker } from "bullmq";
import { pushNotificationQueue } from "../queues.js";
import { createWritebackThreadLabelWorker } from "../jobs/writeback-thread-label.js";

const WS = "ws-1";
const THREAD = "thread-1";

const CONNECTION = {
  provider: "GMAIL" as const,
  encryptedRefreshToken: "enc",
  grantedScopes: ["https://www.googleapis.com/auth/gmail.modify"],
  mailboxKey: "user@example.com",
};

function getProcessor(): (job: unknown) => Promise<void> {
  const WorkerMock = vi.mocked(Worker);
  const lastCall = WorkerMock.mock.calls[WorkerMock.mock.calls.length - 1];
  return lastCall?.[1] as (job: unknown) => Promise<void>;
}

function run() {
  createWritebackThreadLabelWorker();
  return getProcessor()({ data: { workspaceId: WS, emailThreadId: THREAD } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockLoadConnection.mockResolvedValue(CONNECTION);
  vi.mocked(db.emailThread.findFirst).mockResolvedValue({ providerThreadId: "pt-1" } as never);
  vi.mocked(db.emailMessage.findMany).mockResolvedValue([{ providerMessageId: "m-1" }] as never);
  vi.mocked(db.emailClassification.findFirst).mockResolvedValue({ finalNodeId: "node-1" } as never);
  vi.mocked(db.taxonomyNodeProviderLink.findMany).mockResolvedValue([
    { nodeId: "node-1", providerLabelId: "Label_1" },
    { nodeId: "node-2", providerLabelId: "Label_2" },
  ] as never);
  mockApply.mockResolvedValue(undefined);
});

describe("writeback-thread-label worker", () => {
  it("no-ops when writeback is not active (no connection)", async () => {
    mockLoadConnection.mockResolvedValue(null);
    await run();
    expect(mockApply).not.toHaveBeenCalled();
    expect(db.emailThread.findFirst).not.toHaveBeenCalled();
  });

  it("applies the folder's label as the sole desired label, passing the full managed set", async () => {
    await run();
    expect(mockApply).toHaveBeenCalledWith({
      threadId: "pt-1",
      messageIds: ["m-1"],
      desiredLabelIds: ["Label_1"],
      managedLabelIds: ["Label_1", "Label_2"],
    });
  });

  it("resolves to no desired label when the thread is unclassified (null finalNode)", async () => {
    vi.mocked(db.emailClassification.findFirst).mockResolvedValue({ finalNodeId: null } as never);
    await run();
    expect(mockApply).toHaveBeenCalledWith(
      expect.objectContaining({ desiredLabelIds: [], managedLabelIds: ["Label_1", "Label_2"] }),
    );
  });

  it("resolves to no desired label for a root node (no link exists)", async () => {
    vi.mocked(db.emailClassification.findFirst).mockResolvedValue({ finalNodeId: "root-node" } as never);
    // Lazy provision runs but the root node still has no link.
    vi.mocked(db.taxonomyNodeProviderLink.findUnique).mockResolvedValue(null as never);
    await run();
    expect(mockProvision).toHaveBeenCalled();
    expect(mockApply).toHaveBeenCalledWith(expect.objectContaining({ desiredLabelIds: [] }));
  });

  it("lazily provisions when the folder's link is missing, then re-reads it", async () => {
    vi.mocked(db.emailClassification.findFirst).mockResolvedValue({ finalNodeId: "node-new" } as never);
    vi.mocked(db.taxonomyNodeProviderLink.findMany).mockResolvedValue([] as never);
    vi.mocked(db.taxonomyNodeProviderLink.findUnique).mockResolvedValue({
      providerLabelId: "Label_new",
      mailboxKey: CONNECTION.mailboxKey,
    } as never);
    await run();
    expect(mockProvision).toHaveBeenCalledWith(WS, CONNECTION);
    expect(mockApply).toHaveBeenCalledWith(
      expect.objectContaining({ desiredLabelIds: ["Label_new"], managedLabelIds: ["Label_new"] }),
    );
  });

  it("throws UnrecoverableError when the thread does not exist", async () => {
    vi.mocked(db.emailThread.findFirst).mockResolvedValue(null as never);
    await expect(run()).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it("skips silently when the provider reports the thread gone", async () => {
    mockApply.mockRejectedValue(new MailThreadNotFoundError("gone"));
    await expect(run()).resolves.toBeUndefined();
    expect(markGmailConnectionAuthFailed).not.toHaveBeenCalled();
  });

  it("marks the connection disconnected on an auth failure", async () => {
    mockApply.mockRejectedValue(new MailAuthError("bad token"));
    vi.mocked(markGmailConnectionAuthFailed).mockResolvedValue(true as never);
    await run();
    expect(markGmailConnectionAuthFailed).toHaveBeenCalledWith(WS);
    expect(pushNotificationQueue.add).toHaveBeenCalledWith("push-notification", {
      kind: "gmail_disconnected",
      workspaceId: WS,
    });
  });

  it("propagates a transient error so BullMQ retries", async () => {
    mockApply.mockRejectedValue(new Error("503 upstream"));
    await expect(run()).rejects.toThrow("503 upstream");
  });
});
