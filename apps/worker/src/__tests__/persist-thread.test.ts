import { vi, describe, it, expect, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@amarnai/db", () => ({
  db: {
    emailThread: { upsert: vi.fn() },
    emailMessage: { upsert: vi.fn() },
  },
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import { db } from "@amarnai/db";
import { upsertEmailThread, upsertEmailMessages } from "../jobs/persist-thread.js";
import type { ThreadLabelFlags } from "../jobs/filter-thread-messages.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const LABEL_FLAGS: ThreadLabelFlags = {
  gmailIsSpam: false,
  gmailIsPromotions: false,
  gmailIsTrash: false,
  isAutomated: false,
};

const THREAD_INPUT = {
  workspaceId: "ws-1",
  emailAccountId: "acc-1",
  providerThreadId: "gmail-t1",
  subject: "Hello",
  latestMessageAt: new Date("2026-06-01T00:00:00Z"),
  messageCount: 2,
  labelFlags: LABEL_FLAGS,
};

function makeMessage(overrides: Record<string, unknown> = {}) {
  return {
    providerMessageId: "msg-1",
    senderEmail: "sender@example.com",
    senderName: "Sender",
    toEmails: ["me@example.com"],
    ccEmails: [],
    subject: "Hello",
    bodyExcerpt: "a short body",
    receivedAt: new Date("2026-06-01T00:00:00Z"),
    attachments: [],
    labelIds: ["INBOX"],
    automatedHeaders: { listUnsubscribe: false, listId: false, autoSubmitted: null, precedence: null },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.emailThread.upsert).mockResolvedValue({ id: "db-t1" } as never);
  vi.mocked(db.emailMessage.upsert).mockResolvedValue({ id: "db-m1" } as never);
});

// ─── upsertEmailThread ──────────────────────────────────────────────────────────

describe("upsertEmailThread", () => {
  it("returns the upserted thread id", async () => {
    const id = await upsertEmailThread({ ...THREAD_INPUT, updateContent: true });
    expect(id).toBe("db-t1");
  });

  it("keys on emailAccountId + providerThreadId and creates with the full payload", async () => {
    await upsertEmailThread({ ...THREAD_INPUT, updateContent: true });

    const arg = vi.mocked(db.emailThread.upsert).mock.calls[0]![0] as {
      where: { emailAccountId_providerThreadId: { emailAccountId: string; providerThreadId: string } };
      create: Record<string, unknown>;
    };
    expect(arg.where.emailAccountId_providerThreadId).toEqual({
      emailAccountId: "acc-1",
      providerThreadId: "gmail-t1",
    });
    expect(arg.create).toMatchObject({
      workspaceId: "ws-1",
      emailAccountId: "acc-1",
      provider: "GMAIL",
      providerThreadId: "gmail-t1",
      subject: "Hello",
      messageCount: 2,
      isAutomated: false,
    });
  });

  it("updateContent:true refreshes subject/date/count alongside the flags", async () => {
    await upsertEmailThread({ ...THREAD_INPUT, updateContent: true });

    const arg = vi.mocked(db.emailThread.upsert).mock.calls[0]![0] as { update: Record<string, unknown> };
    expect(arg.update).toMatchObject({
      subject: "Hello",
      latestMessageAt: THREAD_INPUT.latestMessageAt,
      messageCount: 2,
    });
  });

  it("updateContent:false updates only the label flags (excluded-thread path)", async () => {
    await upsertEmailThread({ ...THREAD_INPUT, updateContent: false });

    const arg = vi.mocked(db.emailThread.upsert).mock.calls[0]![0] as { update: Record<string, unknown> };
    expect(arg.update).toEqual({ ...LABEL_FLAGS });
    expect(arg.update).not.toHaveProperty("subject");
    expect(arg.update).not.toHaveProperty("latestMessageAt");
    expect(arg.update).not.toHaveProperty("messageCount");
  });
});

// ─── upsertEmailMessages ────────────────────────────────────────────────────────

describe("upsertEmailMessages", () => {
  it("upserts one row per message, keyed on emailAccountId + providerMessageId", async () => {
    await upsertEmailMessages({
      workspaceId: "ws-1",
      emailAccountId: "acc-1",
      emailThreadId: "db-t1",
      messages: [makeMessage({ providerMessageId: "msg-1" }), makeMessage({ providerMessageId: "msg-2" })] as never,
    });

    expect(vi.mocked(db.emailMessage.upsert)).toHaveBeenCalledTimes(2);
    const first = vi.mocked(db.emailMessage.upsert).mock.calls[0]![0] as {
      where: { emailAccountId_providerMessageId: { emailAccountId: string; providerMessageId: string } };
      create: Record<string, unknown>;
    };
    expect(first.where.emailAccountId_providerMessageId).toEqual({ emailAccountId: "acc-1", providerMessageId: "msg-1" });
    expect(first.create).toMatchObject({
      emailThreadId: "db-t1",
      bccEmails: [],
      bodyText: null,
      hasAttachments: false,
    });
  });

  it("truncates the snippet to 200 chars and sets null when there is no body", async () => {
    const longBody = "x".repeat(500);
    await upsertEmailMessages({
      workspaceId: "ws-1",
      emailAccountId: "acc-1",
      emailThreadId: "db-t1",
      messages: [
        makeMessage({ providerMessageId: "long", bodyExcerpt: longBody }),
        makeMessage({ providerMessageId: "empty", bodyExcerpt: null }),
      ] as never,
    });

    const longCreate = (vi.mocked(db.emailMessage.upsert).mock.calls[0]![0] as { create: { snippet: string | null } }).create;
    const emptyCreate = (vi.mocked(db.emailMessage.upsert).mock.calls[1]![0] as { create: { snippet: string | null } }).create;
    expect(longCreate.snippet).toHaveLength(200);
    expect(emptyCreate.snippet).toBeNull();
  });

  it("maps attachment metadata (filename + mimeType) and flags hasAttachments", async () => {
    await upsertEmailMessages({
      workspaceId: "ws-1",
      emailAccountId: "acc-1",
      emailThreadId: "db-t1",
      messages: [
        makeMessage({
          providerMessageId: "att",
          attachments: [{ filename: "doc.pdf", mimeType: "application/pdf", size: 10 }],
        }),
      ] as never,
    });

    const create = (vi.mocked(db.emailMessage.upsert).mock.calls[0]![0] as unknown as {
      create: { hasAttachments: boolean; attachments: Array<Record<string, unknown>> };
    }).create;
    expect(create.hasAttachments).toBe(true);
    expect(create.attachments).toEqual([{ filename: "doc.pdf", mimeType: "application/pdf" }]);
  });
});
