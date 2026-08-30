import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { constantTimeEqual } from "../services/constant-time-equal.js";

// Configure the webhook secrets BEFORE the config/app modules evaluate, so both
// providers have a known secret to verify against. vi.hoisted runs before the
// hoisted imports below.
const { GMAIL_SECRET, OUTLOOK_SECRET } = vi.hoisted(() => {
  process.env.GMAIL_PUBSUB_WEBHOOK_SECRET = "gmail-webhook-secret-value";
  process.env.MS_GRAPH_SUBSCRIPTION_SECRET = "outlook-client-state-value";
  return {
    GMAIL_SECRET: "gmail-webhook-secret-value",
    OUTLOOK_SECRET: "outlook-client-state-value",
  };
});

vi.mock("../services/queue-client.js", () => ({
  syncInboxQueue: {
    addBulk: vi.fn().mockResolvedValue([]),
  },
}));

import app from "../app.js";
import { db } from "@aziru/db";
import { syncInboxQueue } from "../services/queue-client.js";

vi.mock("@aziru/db", () => ({
  db: {
    emailConnection: {
      findMany: vi.fn(),
    },
  },
}));

const findMany = db.emailConnection.findMany as ReturnType<typeof vi.fn>;
const addBulk = syncInboxQueue.addBulk as ReturnType<typeof vi.fn>;

function gmailBody(emailAddress: string, historyId: string) {
  const data = Buffer.from(JSON.stringify({ emailAddress, historyId }), "utf8").toString("base64");
  return { message: { data } };
}

function outlookBody(clientState: string | undefined, subjectId: string) {
  return {
    value: [{ clientState, resource: `Users/${subjectId}/Messages/msg-1` }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  findMany.mockResolvedValue([]);
});

// ── The shared helper ───────────────────────────────────────────────────────
describe("constantTimeEqual", () => {
  it("returns true for identical strings", () => {
    expect(constantTimeEqual("s3cret", "s3cret")).toBe(true);
  });

  it("returns false for different same-length strings", () => {
    expect(constantTimeEqual("s3cret", "s3crxt")).toBe(false);
  });

  it("returns false for different-length strings without throwing", () => {
    expect(constantTimeEqual("short", "a-much-longer-secret")).toBe(false);
  });

  it("returns false when either side is null or undefined (unconfigured secret)", () => {
    expect(constantTimeEqual(undefined, "s3cret")).toBe(false);
    expect(constantTimeEqual("s3cret", undefined)).toBe(false);
    expect(constantTimeEqual(null, null)).toBe(false);
    expect(constantTimeEqual("", undefined)).toBe(false);
  });
});

// ── Gmail Pub/Sub webhook ───────────────────────────────────────────────────
describe("POST /webhooks/gmail auth", () => {
  it("accepts a request with the correct token", async () => {
    const res = await app.request(`/webhooks/gmail?token=${GMAIL_SECRET}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(gmailBody("user@example.com", "123")),
    });
    expect(res.status).toBe(204);
    expect(findMany).toHaveBeenCalled();
  });

  it("rejects a request with a wrong token (401, never reaches the DB)", async () => {
    const res = await app.request(`/webhooks/gmail?token=wrong-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(gmailBody("user@example.com", "123")),
    });
    expect(res.status).toBe(401);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("rejects a request with no token", async () => {
    const res = await app.request(`/webhooks/gmail`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(gmailBody("user@example.com", "123")),
    });
    expect(res.status).toBe(401);
    expect(findMany).not.toHaveBeenCalled();
  });
});

// ── Outlook Graph webhook ───────────────────────────────────────────────────
describe("POST /webhooks/outlook auth", () => {
  it("acts on a notification with the correct clientState", async () => {
    findMany.mockResolvedValue([{ workspaceId: "ws-1" }]);
    const res = await app.request(`/webhooks/outlook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(outlookBody(OUTLOOK_SECRET, "subject-abc")),
    });
    expect(res.status).toBe(202);
    expect(findMany).toHaveBeenCalled();
    expect(addBulk).toHaveBeenCalled();
  });

  it("ignores a notification with a wrong clientState (202, no sync enqueued)", async () => {
    const res = await app.request(`/webhooks/outlook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(outlookBody("wrong-client-state", "subject-abc")),
    });
    expect(res.status).toBe(202);
    expect(findMany).not.toHaveBeenCalled();
    expect(addBulk).not.toHaveBeenCalled();
  });

  it("ignores a notification with a missing clientState", async () => {
    const res = await app.request(`/webhooks/outlook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(outlookBody(undefined, "subject-abc")),
    });
    expect(res.status).toBe(202);
    expect(addBulk).not.toHaveBeenCalled();
  });
});

// ── Regression: the routes must not compare secrets with a raw !== ───────────
// A byte-by-byte `!==` short-circuits and leaks the secret to a timing attack.
// These assert the routes route their secret comparison through the shared
// constant-time helper instead.
describe("webhook routes use the constant-time helper (no raw !== on the secret)", () => {
  const gmailSrc = readFileSync(
    fileURLToPath(new URL("../routes/gmail-webhook.ts", import.meta.url)),
    "utf8",
  );
  const outlookSrc = readFileSync(
    fileURLToPath(new URL("../routes/outlook-webhook.ts", import.meta.url)),
    "utf8",
  );

  it("gmail-webhook.ts imports and uses constantTimeEqual", () => {
    expect(gmailSrc).toContain("constantTimeEqual");
    expect(gmailSrc).not.toMatch(/!==\s*webhookSecret/);
  });

  it("outlook-webhook.ts imports and uses constantTimeEqual", () => {
    expect(outlookSrc).toContain("constantTimeEqual");
    expect(outlookSrc).not.toMatch(/clientState\s*!==\s*secret/);
  });
});
