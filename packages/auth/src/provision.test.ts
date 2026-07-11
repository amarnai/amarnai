import { vi, describe, it, expect, beforeEach } from "vitest";

const { PrismaClientKnownRequestError } = vi.hoisted(() => {
  class PrismaClientKnownRequestError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
    }
  }
  return { PrismaClientKnownRequestError };
});

vi.mock("@amarnai/db", () => {
  const db: Record<string, unknown> = {
    user: { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn() },
    userCredential: { deleteMany: vi.fn() },
    refreshToken: { deleteMany: vi.fn() },
    emailConnection: { upsert: vi.fn(), findUnique: vi.fn() },
  };
  db.$transaction = vi.fn(async (arg: unknown) =>
    typeof arg === "function" ? (arg as (tx: unknown) => unknown)(db) : arg
  );
  return {
    db,
    Prisma: { PrismaClientKnownRequestError },
    ensureInboxTaxonomy: vi.fn(),
    deleteGmailDisconnectedNotifications: vi.fn().mockResolvedValue(undefined),
  };
});

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
  vi.mocked(db.emailConnection.upsert).mockResolvedValue({} as never);
  // Default: no existing connection, so the cross-provider guard is a no-op.
  vi.mocked(db.emailConnection.findUnique).mockResolvedValue(null as never);
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
    expect(db.emailConnection.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: "ws-1" },
        create: expect.objectContaining({
          emailAddress: "a@b.com",
          encryptedRefreshToken: "enc(rt)",
          status: "ACTIVE",
        }),
      })
    );
  });

  it("invalidates an untrusted password credential when Google first verifies the account", async () => {
    // Account pre-hijack: an attacker planted a password on victim@x via
    // /auth/register (row exists, emailVerified null, credential set). The victim
    // now signs in with Google for the first time. That planted credential must
    // be destroyed and any sessions it opened revoked, so it cannot carry over
    // onto the now-verified account.
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "user-1",
      emailVerified: null,
      credential: { id: "cred-1" },
    } as never);

    const result = await provisionGoogleUser({
      email: "victim@x.com",
      gmailAccessToken: "at",
      gmailRefreshToken: "rt",
    });

    expect(db.userCredential.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
    });
    // Refresh tokens are cleared inline (joining the transaction), not via
    // revokeAllRefreshTokensForUser.
    expect(db.refreshToken.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
    });
    // The session epoch is bumped so any planted stateless web JWT is invalidated.
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { sessionEpoch: { increment: 1 } },
    });
    // Invalidation + verify flip run in one transaction.
    expect(db.$transaction).toHaveBeenCalled();
    // The upsert still verifies the account and sign-in still succeeds.
    expect(result.isNew).toBe(false);
    expect(result.gmailConnected).toBe(true);
  });

  it("leaves a returning verified user's password credential untouched", async () => {
    // emailVerified already set: the password was validated (or set via the
    // authenticated reset flow), so re-verifying via Google must not nuke it.
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "user-1",
      emailVerified: new Date(),
      credential: { id: "cred-1" },
    } as never);

    await provisionGoogleUser({
      email: "a@b.com",
      gmailAccessToken: "at",
      gmailRefreshToken: "rt",
    });

    expect(db.userCredential.deleteMany).not.toHaveBeenCalled();
    expect(db.refreshToken.deleteMany).not.toHaveBeenCalled();
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("retries once as an update when a concurrent create wins the race (N9)", async () => {
    // Double OAuth callback: both saw no row; this one's upsert-create loses to the
    // unique email constraint (P2002). It must re-read and retry, not 500.
    vi.mocked(db.user.findUnique).mockResolvedValue(null);
    vi.mocked(db.user.upsert)
      .mockRejectedValueOnce(new PrismaClientKnownRequestError("unique", "P2002") as never)
      .mockResolvedValueOnce({ id: "user-1" } as never);

    const result = await provisionGoogleUser({
      email: "race@b.com",
      gmailAccessToken: "at",
      gmailRefreshToken: "rt",
    });

    expect(result.gmailConnected).toBe(true);
    expect(db.user.findUnique).toHaveBeenCalledTimes(2); // re-read on retry
    expect(db.user.upsert).toHaveBeenCalledTimes(2);
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

  it("signs in a returning Outlook user without clobbering their connection", async () => {
    // The user's default workspace is connected to Outlook. Signing into the
    // (Gmail) extension must not resurrect/overwrite it: sign-in succeeds, but
    // gmailConnected is false and nothing is written to the connection row.
    vi.mocked(db.user.findUnique).mockResolvedValue({ id: "user-1" } as never);
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue({
      provider: "OUTLOOK",
    } as never);

    const result = await provisionGoogleUser({
      email: "a@b.com",
      gmailAccessToken: "at",
      gmailRefreshToken: "rt",
    });

    expect(result).toEqual({
      userId: "user-1",
      workspaceId: null,
      isNew: false,
      gmailConnected: false,
    });
    expect(db.emailConnection.upsert).not.toHaveBeenCalled();
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
    expect(db.emailConnection.upsert).not.toHaveBeenCalled();
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
