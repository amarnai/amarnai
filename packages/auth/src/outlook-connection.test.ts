import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@aziru/db", () => ({
  db: {
    emailConnection: { upsert: vi.fn(), findUnique: vi.fn() },
  },
  deleteGmailDisconnectedNotifications: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@aziru/gmail", () => ({
  encrypt: vi.fn((v: string) => `enc(${v})`),
}));

vi.mock("@aziru/outlook", () => ({
  fetchOutlookProfile: vi.fn(),
}));

import { db } from "@aziru/db";
import { encrypt } from "@aziru/gmail";
import { fetchOutlookProfile } from "@aziru/outlook";
import { storeOutlookConnection } from "./outlook-connection.js";
import { ProviderMismatchError } from "./connection-guard.js";

const OUTLOOK_SCOPE = "Mail.Read";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchOutlookProfile).mockResolvedValue({
    emailAddress: "user@outlook.com",
    subjectId: "entra-object-id",
  } as never);
  vi.mocked(db.emailConnection.upsert).mockResolvedValue({} as never);
  // Default: no existing connection, so the cross-provider guard is a no-op.
  vi.mocked(db.emailConnection.findUnique).mockResolvedValue(null as never);
});

describe("storeOutlookConnection", () => {
  it("verifies the token, encrypts the refresh token, and upserts an OUTLOOK row", async () => {
    const result = await storeOutlookConnection({
      workspaceId: "ws-1",
      accessToken: "at",
      refreshToken: "rt",
      grantedScopes: [OUTLOOK_SCOPE],
    });

    expect(fetchOutlookProfile).toHaveBeenCalledWith("at");
    expect(encrypt).toHaveBeenCalledWith("rt");
    expect(result).toEqual({ emailAddress: "user@outlook.com" });

    const call = vi.mocked(db.emailConnection.upsert).mock.calls[0]![0] as {
      where: { workspaceId: string };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };
    expect(call.where).toEqual({ workspaceId: "ws-1" });
    const shared = {
      provider: "OUTLOOK",
      subjectId: "entra-object-id",
      emailAddress: "user@outlook.com",
      encryptedRefreshToken: "enc(rt)",
      grantedScopes: [OUTLOOK_SCOPE],
      status: "ACTIVE",
    };
    expect(call.create).toMatchObject({ workspaceId: "ws-1", ...shared });
    expect(call.update).toMatchObject(shared);
    expect(call.update).not.toHaveProperty("workspaceId");
  });

  it("refuses to clobber a connection that belongs to Gmail", async () => {
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue({
      provider: "GMAIL",
    } as never);

    await expect(
      storeOutlookConnection({
        workspaceId: "ws-1",
        accessToken: "at",
        refreshToken: "rt",
        grantedScopes: [OUTLOOK_SCOPE],
      })
    ).rejects.toBeInstanceOf(ProviderMismatchError);

    expect(db.emailConnection.upsert).not.toHaveBeenCalled();
    expect(fetchOutlookProfile).not.toHaveBeenCalled();
  });

  it("reactivates an existing OUTLOOK connection (guard is a no-op)", async () => {
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue({
      provider: "OUTLOOK",
    } as never);

    await storeOutlookConnection({
      workspaceId: "ws-1",
      accessToken: "at",
      refreshToken: "rt",
      grantedScopes: [OUTLOOK_SCOPE],
    });

    expect(db.emailConnection.upsert).toHaveBeenCalledOnce();
  });
});
