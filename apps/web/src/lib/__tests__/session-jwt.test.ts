import { vi, describe, it, expect, beforeEach } from "vitest";
import type { JWT } from "next-auth/jwt";

vi.mock("@amarnai/db", () => ({
  db: { user: { findUnique: vi.fn() } },
}));

import { db } from "@amarnai/db";
import { resolveSessionToken, sessionAccountCache } from "../session-jwt";

const account = (over: Partial<{ sessionEpoch: number; emailVerified: Date | null }> = {}) => ({
  id: "user-1",
  name: "Ada",
  emailVerified: "emailVerified" in over ? over.emailVerified : new Date(),
  sessionEpoch: over.sessionEpoch ?? 0,
});

const token = (over: Partial<JWT> = {}): JWT => ({ email: "ada@example.com", ...over });

beforeEach(() => {
  vi.clearAllMocks();
  // The cache is a module singleton shared across cases; isolate each test.
  sessionAccountCache.clear();
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

  it("does NOT downgrade a token whose epoch is above a stale cached epoch (K3)", async () => {
    // Cross-instance: the token was re-minted at epoch 4 on another instance while
    // this instance's cache (or a lagging replica) still reads epoch 3. Enforcement
    // must pass (4 >= 3) WITHOUT stamping 3 back onto the token — otherwise a later
    // fresh read of epoch 4 would sign the still-valid user out.
    vi.mocked(db.user.findUnique).mockResolvedValue(account({ sessionEpoch: 3 }) as never);

    const out = await resolveSessionToken(token({ userId: "user-1", sessionEpoch: 4 }), false);

    expect(out.userId).toBe("user-1");
    expect(out.sessionEpoch).toBe(4); // preserved, never lowered to the DB's 3
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

  // ─── Availability: DB errors must degrade, not 500 the middleware ────────────

  it("leaves an enforcement token unchanged when the DB errors on a cold cache (fail open, not 500)", async () => {
    vi.mocked(db.user.findUnique).mockRejectedValue(new Error("db down"));

    const out = await resolveSessionToken(token({ userId: "user-1", sessionEpoch: 2 }), false);

    // No throw, and the token keeps its identity rather than signing everyone out.
    expect(out.userId).toBe("user-1");
    expect(out.sessionEpoch).toBe(2);
  });

  it("still enforces a revocation seen before the outage (serves stale)", async () => {
    // Warm the cache at epoch 3 via a prior enforcement read.
    vi.mocked(db.user.findUnique).mockResolvedValueOnce(account({ sessionEpoch: 3 }) as never);
    await resolveSessionToken(token({ userId: "user-1", sessionEpoch: 3 }), false);

    // DB now errors; a token below the cached epoch must still sign out.
    vi.mocked(db.user.findUnique).mockRejectedValue(new Error("db down"));
    const out = await resolveSessionToken(token({ userId: "user-1", sessionEpoch: 2 }), false);
    expect(out.userId).toBeUndefined();
  });

  it("fails the mint (propagates) when the DB errors — never stamps a fallback", async () => {
    vi.mocked(db.user.findUnique).mockRejectedValue(new Error("db down"));

    await expect(resolveSessionToken(token(), true)).rejects.toThrow("db down");
  });

  it("re-login right after an epoch bump stamps the NEW epoch, not a stale cached one", async () => {
    // A stale value sits in the cache (old epoch 3) from before the reset.
    vi.mocked(db.user.findUnique).mockResolvedValueOnce(account({ sessionEpoch: 3 }) as never);
    await resolveSessionToken(token({ userId: "user-1", sessionEpoch: 3 }), false);

    // Password reset bumped the account to epoch 4. The mint must bypass the cache
    // and read fresh, or it would stamp 3 and sign itself out next request.
    vi.mocked(db.user.findUnique).mockResolvedValue(account({ sessionEpoch: 4 }) as never);
    const out = await resolveSessionToken(token(), true);
    expect(out.sessionEpoch).toBe(4);
  });
});
