import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@amarnai/db", () => ({
  db: {
    waitlistEntry: { upsert: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    user: { findUnique: vi.fn(), create: vi.fn() },
    userCredential: { update: vi.fn() },
    verificationToken: { deleteMany: vi.fn(), create: vi.fn() },
  },
}));
vi.mock("@/auth", () => ({ signIn: vi.fn(), signOut: vi.fn(), unstable_update: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/email", () => ({
  sendVerificationEmail: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
}));
vi.mock("@/lib/gmail-teardown", () => ({ disconnectGmailBeforeDeletion: vi.fn() }));

let testIp = "10.0.0.1";
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ "x-forwarded-for": testIp })),
}));

import { db } from "@amarnai/db";
import { signIn } from "@/auth";
import { requireUser } from "@/lib/session";
import { createWaitlistFormToken } from "@/lib/waitlist";
import { joinWaitlistAction, toggleWaitlistInvitedAction } from "@/actions/waitlist";
import { registerAction } from "@/actions/auth";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

/** Form data with a token old enough to pass the minimum-fill-time check. */
function humanForm(email: string): FormData {
  return form({ email, ft: createWaitlistFormToken(Date.now() - 5_000) });
}

let ipCounter = 0;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("AUTH_SECRET", "test-secret");
  // Fresh IP per test so the module-level rate limiter never bleeds across tests.
  ipCounter += 1;
  testIp = `10.0.0.${ipCounter}`;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("joinWaitlistAction", () => {
  it("rejects when waitlist mode is off", async () => {
    vi.stubEnv("WAITLIST_MODE", "false");

    const result = await joinWaitlistAction(null, humanForm("user@gmail.com"));

    expect(result.error).toBe("The waitlist is not open.");
    expect(db.waitlistEntry.upsert).not.toHaveBeenCalled();
  });

  it("rejects an invalid email", async () => {
    vi.stubEnv("WAITLIST_MODE", "true");

    const result = await joinWaitlistAction(null, humanForm("not-an-email"));

    expect(result.error).toBe("Invalid email address");
    expect(db.waitlistEntry.upsert).not.toHaveBeenCalled();
  });

  it("stores the email trimmed and lowercased", async () => {
    vi.stubEnv("WAITLIST_MODE", "true");

    const result = await joinWaitlistAction(null, humanForm("  User@Gmail.COM "));

    expect(result).toEqual({ email: "user@gmail.com" });
    expect(db.waitlistEntry.upsert).toHaveBeenCalledWith({
      where: { email: "user@gmail.com" },
      create: { email: "user@gmail.com" },
      update: {},
    });
  });

  it("is idempotent for an address already on the list", async () => {
    vi.stubEnv("WAITLIST_MODE", "true");

    const first = await joinWaitlistAction(null, humanForm("user@gmail.com"));
    const second = await joinWaitlistAction(null, humanForm("user@gmail.com"));

    expect(first).toEqual({ email: "user@gmail.com" });
    expect(second).toEqual({ email: "user@gmail.com" });
  });

  it("rejects a missing or forged form token", async () => {
    vi.stubEnv("WAITLIST_MODE", "true");

    const missing = await joinWaitlistAction(null, form({ email: "user@gmail.com" }));
    const forged = await joinWaitlistAction(
      null,
      form({ email: "user@gmail.com", ft: "not-a-real-token" })
    );

    expect(missing.error).toBe("Something went wrong. Please try again.");
    expect(forged.error).toBe("Something went wrong. Please try again.");
    expect(db.waitlistEntry.upsert).not.toHaveBeenCalled();
  });

  it("rejects a token signed with a different secret", async () => {
    vi.stubEnv("WAITLIST_MODE", "true");
    vi.stubEnv("AUTH_SECRET", "attacker-secret");
    const forged = createWaitlistFormToken(Date.now() - 5_000);
    vi.stubEnv("AUTH_SECRET", "test-secret");

    const result = await joinWaitlistAction(null, form({ email: "user@gmail.com", ft: forged }));

    expect(result.error).toBe("Something went wrong. Please try again.");
    expect(db.waitlistEntry.upsert).not.toHaveBeenCalled();
  });

  it("rejects a submission faster than a human can type", async () => {
    vi.stubEnv("WAITLIST_MODE", "true");

    const result = await joinWaitlistAction(
      null,
      form({ email: "user@gmail.com", ft: createWaitlistFormToken() })
    );

    expect(result.error).toBe("Something went wrong. Please try again.");
    expect(db.waitlistEntry.upsert).not.toHaveBeenCalled();
  });

  it("pretends success without storing when the honeypot is filled", async () => {
    vi.stubEnv("WAITLIST_MODE", "true");
    const fd = humanForm("Bot@Gmail.com");
    fd.set("website", "https://spam.example.com");

    const result = await joinWaitlistAction(null, fd);

    expect(result).toEqual({ email: "bot@gmail.com" });
    expect(db.waitlistEntry.upsert).not.toHaveBeenCalled();
  });

  it("rate limits the fourth submission from the same IP within an hour", async () => {
    vi.stubEnv("WAITLIST_MODE", "true");

    for (let i = 1; i <= 3; i += 1) {
      const ok = await joinWaitlistAction(null, humanForm(`user${i}@gmail.com`));
      expect(ok.error).toBeUndefined();
    }
    const fourth = await joinWaitlistAction(null, humanForm("user4@gmail.com"));

    expect(fourth.error).toBe("Too many attempts. Please try again later.");
    expect(db.waitlistEntry.upsert).toHaveBeenCalledTimes(3);
  });
});

describe("toggleWaitlistInvitedAction", () => {
  it("rejects users not in ADMIN_EMAILS", async () => {
    vi.stubEnv("ADMIN_EMAILS", "owner@gmail.com");
    vi.mocked(requireUser).mockResolvedValue({
      id: "user-1",
      email: "stranger@gmail.com",
      name: null,
      image: null,
    });

    await expect(toggleWaitlistInvitedAction(form({ id: "entry-1" }))).rejects.toThrow(
      "Not authorized"
    );
    expect(db.waitlistEntry.update).not.toHaveBeenCalled();
  });

  it("marks a pending entry as invited", async () => {
    vi.stubEnv("ADMIN_EMAILS", "owner@gmail.com");
    vi.mocked(requireUser).mockResolvedValue({
      id: "user-1",
      email: "Owner@Gmail.com",
      name: null,
      image: null,
    });
    vi.mocked(db.waitlistEntry.findUnique).mockResolvedValue({ invitedAt: null } as never);

    await toggleWaitlistInvitedAction(form({ id: "entry-1" }));

    expect(db.waitlistEntry.update).toHaveBeenCalledWith({
      where: { id: "entry-1" },
      data: { invitedAt: expect.any(Date) },
    });
  });

  it("clears invitedAt when the entry is already invited", async () => {
    vi.stubEnv("ADMIN_EMAILS", "owner@gmail.com");
    vi.mocked(requireUser).mockResolvedValue({
      id: "user-1",
      email: "owner@gmail.com",
      name: null,
      image: null,
    });
    vi.mocked(db.waitlistEntry.findUnique).mockResolvedValue({
      invitedAt: new Date("2026-06-01"),
    } as never);

    await toggleWaitlistInvitedAction(form({ id: "entry-1" }));

    expect(db.waitlistEntry.update).toHaveBeenCalledWith({
      where: { id: "entry-1" },
      data: { invitedAt: null },
    });
  });

  it("throws for an unknown entry id", async () => {
    vi.stubEnv("ADMIN_EMAILS", "owner@gmail.com");
    vi.mocked(requireUser).mockResolvedValue({
      id: "user-1",
      email: "owner@gmail.com",
      name: null,
      image: null,
    });
    vi.mocked(db.waitlistEntry.findUnique).mockResolvedValue(null as never);

    await expect(toggleWaitlistInvitedAction(form({ id: "missing" }))).rejects.toThrow(
      "Waitlist entry not found"
    );
    expect(db.waitlistEntry.update).not.toHaveBeenCalled();
  });
});

describe("registerAction under waitlist mode", () => {
  it("rejects registration while waitlist mode is on", async () => {
    vi.stubEnv("WAITLIST_MODE", "true");

    const result = await registerAction(
      null,
      form({ email: "user@example.com", password: "password123" })
    );

    expect(result.error).toBe(
      "Sign-ups are currently invite-only. Join the waitlist to get access."
    );
    expect(db.user.findUnique).not.toHaveBeenCalled();
    expect(signIn).not.toHaveBeenCalled();
  });

  it("registers normally when waitlist mode is off", async () => {
    vi.stubEnv("WAITLIST_MODE", "false");
    vi.mocked(db.user.findUnique).mockResolvedValue(null);
    vi.mocked(db.user.create).mockResolvedValue({ id: "user-1" } as never);

    const result = await registerAction(
      null,
      form({ email: "user@example.com", password: "password123" })
    );

    expect(result.error).toBeUndefined();
    expect(db.user.create).toHaveBeenCalled();
    expect(signIn).toHaveBeenCalled();
  });
});
