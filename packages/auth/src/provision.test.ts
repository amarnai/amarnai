import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@amarnai/db", () => ({
  db: {
    user: { findUnique: vi.fn(), upsert: vi.fn() },
    gmailConnection: { upsert: vi.fn() },
  },
  ensureInboxNode: vi.fn(),
}));

vi.mock("@amarnai/gmail", () => ({
  encrypt: vi.fn((v: string) => `enc(${v})`),
  fetchGmailProfile: vi.fn(),
  GMAIL_READONLY_SCOPE: "https://www.googleapis.com/auth/gmail.readonly",
}));

vi.mock("./workspace.js", () => ({
  getOrCreateDefaultWorkspace: vi.fn(),
}));

import { db } from "@amarnai/db";
import { encrypt, fetchGmailProfile } from "@amarnai/gmail";
import { getOrCreateDefaultWorkspace } from "./workspace.js";
import { provisionGoogleUser } from "./provision.js";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.user.upsert).mockResolvedValue({ id: "user-1" } as never);
  vi.mocked(getOrCreateDefaultWorkspace).mockResolvedValue({
    id: "ws-1",
    name: "My Workspace",
    plan: "FREE",
  } as never);
  vi.mocked(fetchGmailProfile).mockResolvedValue({ emailAddress: "a@b.com" } as never);
  vi.mocked(db.gmailConnection.upsert).mockResolvedValue({} as never);
});

describe("provisionGoogleUser", () => {
  it("flags a brand-new user and connects Gmail when tokens are present", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(null); // no existing user

    const result = await provisionGoogleUser({
      email: "a@b.com",
      gmailAccessToken: "at",
      gmailRefreshToken: "rt",
    });

    expect(result).toEqual({
      userId: "user-1",
      workspaceId: "ws-1",
      isNew: true,
      gmailConnected: true,
    });
    // Refresh token is encrypted before being stored.
    expect(encrypt).toHaveBeenCalledWith("rt");
    expect(db.gmailConnection.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: "ws-1" },
        create: expect.objectContaining({
          gmailAddress: "a@b.com",
          encryptedRefreshToken: "enc(rt)",
          status: "ACTIVE",
        }),
      })
    );
  });

  it("flags a returning user as not new", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({ id: "user-1" } as never);

    const result = await provisionGoogleUser({
      email: "a@b.com",
      gmailAccessToken: "at",
      gmailRefreshToken: "rt",
    });

    expect(result.isNew).toBe(false);
    expect(result.gmailConnected).toBe(true);
  });

  it("skips Gmail setup when no tokens are supplied", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(null);

    const result = await provisionGoogleUser({ email: "a@b.com" });

    expect(result).toEqual({
      userId: "user-1",
      workspaceId: null,
      isNew: true,
      gmailConnected: false,
    });
    expect(getOrCreateDefaultWorkspace).not.toHaveBeenCalled();
    expect(db.gmailConnection.upsert).not.toHaveBeenCalled();
  });

  it("keeps sign-in alive (non-fatal) when Gmail setup throws", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(null);
    vi.mocked(fetchGmailProfile).mockRejectedValue(new Error("gmail down"));

    const result = await provisionGoogleUser({
      email: "a@b.com",
      gmailAccessToken: "at",
      gmailRefreshToken: "rt",
    });

    expect(result).toEqual({
      userId: "user-1",
      workspaceId: null,
      isNew: true,
      gmailConnected: false,
    });
  });
});
