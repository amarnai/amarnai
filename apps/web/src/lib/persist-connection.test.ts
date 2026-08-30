import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@aziru/db", () => ({
  db: { emailConnection: { upsert: vi.fn() } },
}));

import { db } from "@aziru/db";
import { persistEmailConnection } from "./persist-connection";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("persistEmailConnection", () => {
  it("resets every provider-scoped field on both create and update so a provider swap cannot inherit stale state", async () => {
    await persistEmailConnection({
      workspaceId: "ws-1",
      provider: "GMAIL",
      subjectId: null,
      emailAddress: "user@gmail.com",
      encryptedRefreshToken: "enc",
      grantedScopes: ["gmail.readonly"],
    });

    const call = vi.mocked(db.emailConnection.upsert).mock.calls[0]![0] as {
      where: unknown;
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };

    // The update path is the regression: switching Outlook -> Gmail must
    // overwrite provider AND clear the stale Outlook subjectId / watch expiry.
    expect(call.update).toMatchObject({
      provider: "GMAIL",
      subjectId: null,
      emailAddress: "user@gmail.com",
      status: "ACTIVE",
      watchExpiresAt: null,
    });
    // create carries the same reset fields plus the workspace id.
    expect(call.create).toMatchObject({
      workspaceId: "ws-1",
      provider: "GMAIL",
      subjectId: null,
      status: "ACTIVE",
      watchExpiresAt: null,
    });
  });

  it("persists the Outlook subject id when connecting Outlook", async () => {
    await persistEmailConnection({
      workspaceId: "ws-1",
      provider: "OUTLOOK",
      subjectId: "entra-object-id",
      emailAddress: "user@outlook.com",
      encryptedRefreshToken: "enc",
      grantedScopes: ["Mail.Read"],
    });

    const call = vi.mocked(db.emailConnection.upsert).mock.calls[0]![0] as {
      update: Record<string, unknown>;
    };
    expect(call.update).toMatchObject({
      provider: "OUTLOOK",
      subjectId: "entra-object-id",
      watchExpiresAt: null,
    });
  });
});
