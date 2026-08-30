import { vi, describe, it, expect, beforeEach } from "vitest";
import bcrypt from "bcryptjs";

vi.mock("@aziru/db", () => ({
  db: {
    user: { findUnique: vi.fn() },
  },
}));

import { db } from "@aziru/db";
import { verifyCredentials } from "./credentials.js";

const PASSWORD = "correct-horse";
let passwordHash: string;

beforeEach(async () => {
  vi.clearAllMocks();
  passwordHash = await bcrypt.hash(PASSWORD, 4);
});

describe("verifyCredentials", () => {
  it("returns the user id for a correct password", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "user-1",
      credential: { passwordHash },
    } as never);

    expect(await verifyCredentials("a@b.com", PASSWORD)).toBe("user-1");
    // Single round-trip (credential fetched via the relation).
    expect(db.user.findUnique).toHaveBeenCalledTimes(1);
  });

  it("returns null for a wrong password", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "user-1",
      credential: { passwordHash },
    } as never);

    expect(await verifyCredentials("a@b.com", "wrong")).toBeNull();
  });

  it("returns null for an unknown user", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(null);
    expect(await verifyCredentials("missing@b.com", PASSWORD)).toBeNull();
  });

  it("returns null for a Google-only account with no password set", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "user-1",
      credential: null,
    } as never);

    expect(await verifyCredentials("a@b.com", PASSWORD)).toBeNull();
  });
});
