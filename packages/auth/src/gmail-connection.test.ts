import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@amarnai/db", () => ({
  db: {
    gmailConnection: { upsert: vi.fn() },
  },
}));

vi.mock("@amarnai/gmail", () => ({
  encrypt: vi.fn((v: string) => `enc(${v})`),
  fetchGmailProfile: vi.fn(),
}));

import { db } from "@amarnai/db";
import { encrypt, fetchGmailProfile } from "@amarnai/gmail";
import { storeGmailConnection } from "./gmail-connection.js";

const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchGmailProfile).mockResolvedValue({ emailAddress: "a@b.com" } as never);
  vi.mocked(db.gmailConnection.upsert).mockResolvedValue({} as never);
});

describe("storeGmailConnection", () => {
  it("verifies the token, encrypts the refresh token, and upserts the connection", async () => {
    const result = await storeGmailConnection({
      workspaceId: "ws-1",
      accessToken: "at",
      refreshToken: "rt",
      grantedScopes: [GMAIL_SCOPE],
      oauthClient: "WEB",
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
      oauthClient: "MOBILE",
    });

    const call = vi.mocked(db.gmailConnection.upsert).mock.calls[0]![0] as {
      where: { workspaceId: string };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };

    expect(call.where).toEqual({ workspaceId: "ws-1" });
    const sharedFields = {
      gmailAddress: "a@b.com",
      encryptedRefreshToken: "enc(rt)",
      grantedScopes: [GMAIL_SCOPE],
      // The minting client is persisted so the worker refreshes with the right one.
      oauthClient: "MOBILE",
      status: "ACTIVE",
    };
    expect(call.create).toMatchObject({ workspaceId: "ws-1", ...sharedFields });
    expect(call.update).toMatchObject(sharedFields);
    // The workspace key only belongs on create.
    expect(call.update).not.toHaveProperty("workspaceId");
  });

  it("propagates a profile-fetch failure and stores nothing", async () => {
    vi.mocked(fetchGmailProfile).mockRejectedValue(new Error("401"));

    await expect(
      storeGmailConnection({
        workspaceId: "ws-1",
        accessToken: "bad",
        refreshToken: "rt",
        grantedScopes: [GMAIL_SCOPE],
        oauthClient: "WEB",
      })
    ).rejects.toThrow("401");

    expect(db.gmailConnection.upsert).not.toHaveBeenCalled();
  });
});
