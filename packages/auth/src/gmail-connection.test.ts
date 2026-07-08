import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@amarnai/db", () => ({
  db: {
    emailConnection: { upsert: vi.fn(), findUnique: vi.fn() },
  },
  deleteGmailDisconnectedNotifications: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@amarnai/gmail", () => ({
  encrypt: vi.fn((v: string) => `enc(${v})`),
  fetchGmailProfile: vi.fn(),
}));

import { db } from "@amarnai/db";
import { encrypt, fetchGmailProfile } from "@amarnai/gmail";
import { storeGmailConnection, ProviderMismatchError } from "./gmail-connection.js";

const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchGmailProfile).mockResolvedValue({ emailAddress: "a@b.com" } as never);
  vi.mocked(db.emailConnection.upsert).mockResolvedValue({} as never);
  // Default: no existing connection, so the cross-provider guard is a no-op.
  vi.mocked(db.emailConnection.findUnique).mockResolvedValue(null as never);
});

describe("storeGmailConnection", () => {
  it("verifies the token, encrypts the refresh token, and upserts the connection", async () => {
    const result = await storeGmailConnection({
      workspaceId: "ws-1",
      accessToken: "at",
      refreshToken: "rt",
      grantedScopes: [GMAIL_SCOPE],
    });

    // The access token is used to confirm Gmail access before anything is stored.
    expect(fetchGmailProfile).toHaveBeenCalledWith("at");
    // The refresh token is never stored in plaintext.
    expect(encrypt).toHaveBeenCalledWith("rt");

    expect(result).toEqual({ gmailAddress: "a@b.com" });
  });

  it("writes identical data on create and update so the upsert is idempotent", async () => {
    await storeGmailConnection({
      workspaceId: "ws-1",
      accessToken: "at",
      refreshToken: "rt",
      grantedScopes: [GMAIL_SCOPE],
    });

    const call = vi.mocked(db.emailConnection.upsert).mock.calls[0]![0] as {
      where: { workspaceId: string };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };

    expect(call.where).toEqual({ workspaceId: "ws-1" });
    const sharedFields = {
      emailAddress: "a@b.com",
      encryptedRefreshToken: "enc(rt)",
      grantedScopes: [GMAIL_SCOPE],
      status: "ACTIVE",
    };
    expect(call.create).toMatchObject({ workspaceId: "ws-1", ...sharedFields });
    expect(call.update).toMatchObject(sharedFields);
    // The workspace key only belongs on create.
    expect(call.update).not.toHaveProperty("workspaceId");
  });

  it("reuses/reactivates an existing GMAIL connection (guard is a no-op)", async () => {
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue({
      provider: "GMAIL",
    } as never);

    await storeGmailConnection({
      workspaceId: "ws-1",
      accessToken: "at",
      refreshToken: "rt",
      grantedScopes: [GMAIL_SCOPE],
    });

    expect(db.emailConnection.upsert).toHaveBeenCalledOnce();
  });

  it("refuses to clobber a connection that belongs to another provider", async () => {
    // A DISCONNECTED Outlook row must not be reactivated by a Gmail connect —
    // this is the extension-sign-in resurrection bug.
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue({
      provider: "OUTLOOK",
    } as never);

    await expect(
      storeGmailConnection({
        workspaceId: "ws-1",
        accessToken: "at",
        refreshToken: "rt",
        grantedScopes: [GMAIL_SCOPE],
      })
    ).rejects.toBeInstanceOf(ProviderMismatchError);

    // Nothing is written, and the Gmail API is never even called.
    expect(db.emailConnection.upsert).not.toHaveBeenCalled();
    expect(fetchGmailProfile).not.toHaveBeenCalled();
  });

  it("propagates a profile-fetch failure and stores nothing", async () => {
    vi.mocked(fetchGmailProfile).mockRejectedValue(new Error("401"));

    await expect(
      storeGmailConnection({
        workspaceId: "ws-1",
        accessToken: "bad",
        refreshToken: "rt",
        grantedScopes: [GMAIL_SCOPE],
      })
    ).rejects.toThrow("401");

    expect(db.emailConnection.upsert).not.toHaveBeenCalled();
  });
});
