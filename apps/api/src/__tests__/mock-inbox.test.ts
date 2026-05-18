import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

vi.mock("@genizor/db", () => ({
  Prisma: {},
  db: {
    workspace: { findUnique: vi.fn() },
    emailThread: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    emailMessage: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    emailClassification: { create: vi.fn() },
    reviewItem: { create: vi.fn() },
  },
}));

import app from "../app.js";
import { db } from "@genizor/db";

const WS_ID = "ws-1";
const THREAD_ID = "thread-1";
const MSG_ID = "msg-1";
const CLS_ID = "cls-1";
const REVIEW_ID = "review-1";
const ACCOUNT_ID = "account-1";
const NODE_ROOT = { id: "node-root", name: "Inbox", isRoot: true, canReceiveEmails: false };
const NODE_LEAF = { id: "node-leaf", name: "Clients", isRoot: false, canReceiveEmails: true };

const mockWorkspace = {
  id: WS_ID,
  emailAccounts: [{ id: ACCOUNT_ID }],
  taxonomyNodes: [NODE_ROOT, NODE_LEAF],
};

const mockThread = {
  id: THREAD_ID,
  subject: "Test Thread",
  messageCount: 1,
  latestMessageAt: new Date().toISOString(),
  emailAccountId: ACCOUNT_ID,
};

const mockMessages = [
  { subject: "Hello", senderEmail: "test@example.com", senderName: "Test", bodyText: "Hello world" },
];

function post(path: string, body: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env["ENABLE_DEV_TOOLS"] = "true";
  // Provide a default mock so routes that call reviewItem.create don't throw.
  vi.mocked(db.reviewItem.create).mockResolvedValue({ id: REVIEW_ID } as never);
});

afterEach(() => {
  delete process.env["ENABLE_DEV_TOOLS"];
});

// ─── Dev guard ────────────────────────────────────────────────────────────────

describe("dev guard", () => {
  it("returns 404 when ENABLE_DEV_TOOLS is not set and NODE_ENV is not development", async () => {
    delete process.env["ENABLE_DEV_TOOLS"];
    // NODE_ENV is "test" in vitest, so neither condition passes

    const res = await post(`/dev/workspaces/${WS_ID}/mock-inbox-event`, {
      mode: "new_thread",
      senderEmail: "test@example.com",
      bodyText: "Hello world",
    });

    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("Not found");
  });

  it("returns 201 when ENABLE_DEV_TOOLS is set", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue(mockWorkspace as never);
    vi.mocked(db.emailThread.create).mockResolvedValue({ id: THREAD_ID } as never);
    vi.mocked(db.emailMessage.create).mockResolvedValue({ id: MSG_ID } as never);
    // "clients" matches NODE_LEAF name → confidence 0.76 → no review item
    vi.mocked(db.emailMessage.findMany).mockResolvedValue([
      { subject: null, senderEmail: "test@example.com", senderName: null, bodyText: "Clients meeting" },
    ] as never);
    vi.mocked(db.emailThread.findUniqueOrThrow).mockResolvedValue(mockThread as never);
    vi.mocked(db.emailClassification.create).mockResolvedValue({ id: CLS_ID } as never);

    const res = await post(`/dev/workspaces/${WS_ID}/mock-inbox-event`, {
      mode: "new_thread",
      senderEmail: "test@example.com",
      bodyText: "Clients meeting",
    });

    expect(res.status).toBe(201);
  });
});

// ─── New thread mode ──────────────────────────────────────────────────────────

describe("new thread mode", () => {
  it("creates thread + message + classification", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue(mockWorkspace as never);
    vi.mocked(db.emailThread.create).mockResolvedValue({ id: THREAD_ID } as never);
    vi.mocked(db.emailMessage.create).mockResolvedValue({ id: MSG_ID } as never);
    // "clients" matches NODE_LEAF name → confidence 0.76 → needsHumanReview = false
    vi.mocked(db.emailMessage.findMany).mockResolvedValue([
      { subject: "Clients kickoff", senderEmail: "alice@example.com", senderName: "Alice", bodyText: "Clients project kickoff." },
    ] as never);
    vi.mocked(db.emailThread.findUniqueOrThrow).mockResolvedValue(mockThread as never);
    vi.mocked(db.emailClassification.create).mockResolvedValue({ id: CLS_ID } as never);

    const res = await post(`/dev/workspaces/${WS_ID}/mock-inbox-event`, {
      mode: "new_thread",
      subject: "Clients kickoff",
      senderName: "Alice Smith",
      senderEmail: "alice@example.com",
      bodyText: "Clients project kickoff.",
    });

    expect(res.status).toBe(201);
    const body = await res.json() as Record<string, unknown>;
    expect(body.thread).toMatchObject({ id: THREAD_ID, isNew: true });
    expect(body.classification).toMatchObject({ id: CLS_ID });
    expect(body.reviewItemCreated).toBe(false);
    expect(db.emailThread.create).toHaveBeenCalledTimes(1);
    expect(db.emailMessage.create).toHaveBeenCalledTimes(1);
    expect(db.emailClassification.create).toHaveBeenCalledTimes(1);
    expect(db.reviewItem.create).not.toHaveBeenCalled();
  });

  it("creates a review item when confidence is low (no keyword matches)", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue(mockWorkspace as never);
    vi.mocked(db.emailThread.create).mockResolvedValue({ id: THREAD_ID } as never);
    vi.mocked(db.emailMessage.create).mockResolvedValue({ id: MSG_ID } as never);
    // No keyword matches → confidence 0.35 → needsHumanReview = true
    vi.mocked(db.emailMessage.findMany).mockResolvedValue([
      { subject: null, senderEmail: "x@y.com", senderName: null, bodyText: "zzz" },
    ] as never);
    vi.mocked(db.emailThread.findUniqueOrThrow).mockResolvedValue(mockThread as never);
    vi.mocked(db.emailClassification.create).mockResolvedValue({ id: CLS_ID } as never);
    vi.mocked(db.reviewItem.create).mockResolvedValue({ id: REVIEW_ID } as never);

    const res = await post(`/dev/workspaces/${WS_ID}/mock-inbox-event`, {
      mode: "new_thread",
      senderEmail: "x@y.com",
      bodyText: "zzz",
    });

    expect(res.status).toBe(201);
    const body = await res.json() as Record<string, unknown>;
    expect(body.reviewItemCreated).toBe(true);
    expect(body.reviewItemId).toBe(REVIEW_ID);
    expect(db.reviewItem.create).toHaveBeenCalledTimes(1);
  });

  it("returns 404 when workspace not found", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue(null);

    const res = await post(`/dev/workspaces/${WS_ID}/mock-inbox-event`, {
      mode: "new_thread",
      senderEmail: "test@example.com",
      bodyText: "Hello",
    });

    expect(res.status).toBe(404);
  });

  it("returns 400 on missing senderEmail", async () => {
    const res = await post(`/dev/workspaces/${WS_ID}/mock-inbox-event`, {
      mode: "new_thread",
      bodyText: "Hello",
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("Validation error");
  });

  it("returns 400 on missing bodyText", async () => {
    const res = await post(`/dev/workspaces/${WS_ID}/mock-inbox-event`, {
      mode: "new_thread",
      senderEmail: "test@example.com",
    });

    expect(res.status).toBe(400);
  });
});

// ─── Existing thread mode ─────────────────────────────────────────────────────

describe("existing thread mode", () => {
  it("appends message, updates thread, and creates new classification", async () => {
    const updatedThread = { ...mockThread, messageCount: 2 };
    vi.mocked(db.workspace.findUnique).mockResolvedValue(mockWorkspace as never);
    vi.mocked(db.emailThread.findFirst).mockResolvedValue(
      { id: THREAD_ID, emailAccountId: ACCOUNT_ID } as never
    );
    vi.mocked(db.emailMessage.create).mockResolvedValue({ id: MSG_ID } as never);
    vi.mocked(db.emailThread.update).mockResolvedValue(updatedThread as never);
    vi.mocked(db.emailMessage.findMany).mockResolvedValue(mockMessages as never);
    vi.mocked(db.emailThread.findUniqueOrThrow).mockResolvedValue(updatedThread as never);
    vi.mocked(db.emailClassification.create).mockResolvedValue({ id: CLS_ID } as never);

    const res = await post(`/dev/workspaces/${WS_ID}/mock-inbox-event`, {
      mode: "existing_thread",
      threadId: THREAD_ID,
      senderEmail: "bob@example.com",
      bodyText: "Following up on my last message.",
    });

    expect(res.status).toBe(201);
    const body = await res.json() as Record<string, unknown>;
    expect(body.thread).toMatchObject({ id: THREAD_ID, isNew: false, messageCount: 2 });
    expect(db.emailThread.create).not.toHaveBeenCalled();
    expect(db.emailThread.findFirst).toHaveBeenCalledTimes(1);
    expect(db.emailThread.update).toHaveBeenCalledTimes(1);
    expect(db.emailMessage.create).toHaveBeenCalledTimes(1);
    expect(db.emailClassification.create).toHaveBeenCalledTimes(1);
  });

  it("repeated incoming messages each create a new classification row", async () => {
    const twoMessages = [
      ...mockMessages,
      { subject: null, senderEmail: "bob@example.com", senderName: null, bodyText: "Second message" },
    ];
    vi.mocked(db.workspace.findUnique).mockResolvedValue(mockWorkspace as never);
    vi.mocked(db.emailThread.findFirst).mockResolvedValue(
      { id: THREAD_ID, emailAccountId: ACCOUNT_ID } as never
    );
    vi.mocked(db.emailMessage.create).mockResolvedValue({ id: MSG_ID } as never);
    vi.mocked(db.emailThread.update).mockResolvedValue(mockThread as never);
    vi.mocked(db.emailMessage.findMany).mockResolvedValue(twoMessages as never);
    vi.mocked(db.emailThread.findUniqueOrThrow).mockResolvedValue(
      { ...mockThread, messageCount: 2 } as never
    );
    vi.mocked(db.emailClassification.create).mockResolvedValue({ id: "cls-2" } as never);

    const res = await post(`/dev/workspaces/${WS_ID}/mock-inbox-event`, {
      mode: "existing_thread",
      threadId: THREAD_ID,
      senderEmail: "bob@example.com",
      bodyText: "Second message",
    });

    expect(res.status).toBe(201);
    // Each event creates exactly one new classification (history is accumulated in DB)
    expect(db.emailClassification.create).toHaveBeenCalledTimes(1);
  });

  it("returns 404 when thread not found", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue(mockWorkspace as never);
    vi.mocked(db.emailThread.findFirst).mockResolvedValue(null);

    const res = await post(`/dev/workspaces/${WS_ID}/mock-inbox-event`, {
      mode: "existing_thread",
      threadId: "nonexistent",
      senderEmail: "test@example.com",
      bodyText: "Hello",
    });

    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("Thread not found");
  });

  it("returns 400 when threadId is missing", async () => {
    const res = await post(`/dev/workspaces/${WS_ID}/mock-inbox-event`, {
      mode: "existing_thread",
      senderEmail: "test@example.com",
      bodyText: "Hello",
    });

    expect(res.status).toBe(400);
  });
});
