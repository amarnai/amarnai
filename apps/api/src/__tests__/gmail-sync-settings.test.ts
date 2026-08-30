import { vi, describe, it, expect, beforeEach } from "vitest";
import { authed } from "./helpers.js";

const { mockProviderHasWritebackScope } = vi.hoisted(() => ({
  mockProviderHasWritebackScope: vi.fn(),
}));

vi.mock("@aziru/db", () => {
  const db = {
    workspace: { findUnique: vi.fn() },
    workspaceMember: { findUnique: vi.fn() },
    gmailSyncSettings: { findUnique: vi.fn(), upsert: vi.fn() },
    emailConnection: { findUnique: vi.fn() },
  };
  return { db };
});

vi.mock("@aziru/mail", () => ({
  providerHasWritebackScope: mockProviderHasWritebackScope,
}));

vi.mock("../queues.js", () => ({
  provisionLabelsQueue: { add: vi.fn().mockResolvedValue({}) },
}));

import app from "../app.js";
import { db } from "@aziru/db";
import { config } from "@aziru/config";

const WS = "ws-1";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: WS } as never);
  vi.mocked(db.workspaceMember.findUnique).mockResolvedValue({ role: "OWNER" } as never);
  vi.mocked(db.gmailSyncSettings.findUnique).mockResolvedValue(null as never);
  vi.mocked(db.emailConnection.findUnique).mockResolvedValue(null as never);
  mockProviderHasWritebackScope.mockReturnValue(false);
});

async function getSettings(): Promise<Record<string, unknown>> {
  const res = await app.request(
    `/workspaces/${WS}/gmail-sync-settings`,
    authed({ method: "GET" })
  );
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}

describe("GET /workspaces/:id/gmail-sync-settings — capability flags", () => {
  it("reports whether the deployment has writeback switched on", async () => {
    // The flag is deployment config, so a client has no way to know it: without
    // this it would show the control and only learn on a rejected write.
    const original = config.mail.labelWritebackEnabled;
    try {
      (config.mail as { labelWritebackEnabled: boolean }).labelWritebackEnabled = true;
      expect((await getSettings())["writebackAvailable"]).toBe(true);

      (config.mail as { labelWritebackEnabled: boolean }).labelWritebackEnabled = false;
      expect((await getSettings())["writebackAvailable"]).toBe(false);
    } finally {
      (config.mail as { labelWritebackEnabled: boolean }).labelWritebackEnabled = original;
    }
  });

  it("reports the write scope for an active connection", async () => {
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue({
      provider: "GMAIL",
      status: "ACTIVE",
      grantedScopes: ["https://www.googleapis.com/auth/gmail.modify"],
    } as never);
    mockProviderHasWritebackScope.mockReturnValue(true);

    expect((await getSettings())["hasWritebackScope"]).toBe(true);
    expect(mockProviderHasWritebackScope).toHaveBeenCalledWith("GMAIL", [
      "https://www.googleapis.com/auth/gmail.modify",
    ]);
  });

  it("reports no write scope when the connection is not active", async () => {
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue({
      provider: "GMAIL",
      status: "DISCONNECTED",
      grantedScopes: ["https://www.googleapis.com/auth/gmail.modify"],
    } as never);
    mockProviderHasWritebackScope.mockReturnValue(true);

    // A disconnected mailbox cannot be written to whatever it once granted.
    expect((await getSettings())["hasWritebackScope"]).toBe(false);
    expect(mockProviderHasWritebackScope).not.toHaveBeenCalled();
  });

  it("reports no write scope when no mailbox is connected", async () => {
    expect((await getSettings())["hasWritebackScope"]).toBe(false);
  });

  it("still returns the stored settings alongside the flags", async () => {
    vi.mocked(db.gmailSyncSettings.findUnique).mockResolvedValue({
      includeSpam: true,
      includePromotions: false,
      sortingPaused: false,
      routeBulkToOther: true,
      labelWritebackEnabled: false,
      threadSummaryInjectionEnabled: true,
      replyButtonInjectionEnabled: true,
      blacklistedSenderEmails: ["spam@example.com"],
    } as never);

    const body = await getSettings();

    expect(body["includeSpam"]).toBe(true);
    expect(body["labelWritebackEnabled"]).toBe(false);
    expect(body["blacklistedSenderEmails"]).toEqual(["spam@example.com"]);
    expect(body).toHaveProperty("writebackAvailable");
    expect(body).toHaveProperty("hasWritebackScope");
  });

  it("falls back to defaults plus flags when no row exists yet", async () => {
    const body = await getSettings();

    expect(body["includeSpam"]).toBe(false);
    expect(body["labelWritebackEnabled"]).toBe(true);
    expect(body).toHaveProperty("hasWritebackScope", false);
  });
});
