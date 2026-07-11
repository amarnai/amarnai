import { vi, describe, it, expect, beforeEach } from "vitest";
import type { JWT } from "next-auth/jwt";

vi.mock("@amarnai/db", () => ({
  db: { user: { findUnique: vi.fn() } },
}));

import { db } from "@amarnai/db";
import { resolveSessionToken } from "../session-jwt";

const account = (over: Partial<{ sessionEpoch: number; emailVerified: Date | null }> = {}) => ({
  id: "user-1",
  name: "Ada",
  emailVerified: "emailVerified" in over ? over.emailVerified : new Date(),
  sessionEpoch: over.sessionEpoch ?? 0,
});

const token = (over: Partial<JWT> = {}): JWT => ({ email: "ada@example.com", ...over });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveSessionToken", () => {
  it("stamps identity and epoch on the initial sign-in mint (token has no epoch yet)", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(account({ sessionEpoch: 3 }) as never);

    const out = await resolveSessionToken(token(), true);

    expect(out.userId).toBe("user-1");
    expect(out.sessionEpoch).toBe(3);
    expect(out.isEmailVerified).toBe(true);
  });

  it("enforces the epoch on an ordinary request (K2): a token below the current epoch signs out", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(account({ sessionEpoch: 3 }) as never);

    // Not a mint — this is the path that used to be skipped when needsLookup was false.
    const out = await resolveSessionToken(token({ userId: "user-1", sessionEpoch: 2 }), false);

    expect(out.userId).toBeUndefined();
    expect(out.isEmailVerified).toBeUndefined();
  });

  it("treats a token with NO epoch claim as stale and never re-stamps it (N2)", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(account({ sessionEpoch: 0 }) as never);

    // Pre-feature / planted token: userId present, but no sessionEpoch.
    const out = await resolveSessionToken(token({ userId: "user-1" }), false);

    expect(out.userId).toBeUndefined();
    // Crucially NOT laundered up to the current epoch.
    expect(out.sessionEpoch).toBeUndefined();
  });

  it("keeps a current-epoch token and refreshes its fields", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(
      account({ sessionEpoch: 3, emailVerified: null }) as never,
    );

    const out = await resolveSessionToken(token({ userId: "user-1", sessionEpoch: 3 }), false);

    expect(out.userId).toBe("user-1");
    expect(out.sessionEpoch).toBe(3);
    expect(out.isEmailVerified).toBe(false); // reflects the DB, refreshed every request
  });

  it("signs out when the account no longer exists (deleted)", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(null as never);

    const out = await resolveSessionToken(token({ userId: "user-1", sessionEpoch: 3 }), false);

    expect(out.userId).toBeUndefined();
  });

  it("signs out a token with no email (nothing to verify against)", async () => {
    const out = await resolveSessionToken({ userId: "user-1" } as JWT, false);

    expect(out.userId).toBeUndefined();
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });
});
