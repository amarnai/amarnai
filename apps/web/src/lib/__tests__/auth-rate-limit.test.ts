import { describe, it, expect } from "vitest";
import {
  isLoginBlockedByCounts,
  loginEmailKey,
  loginIpEmailKey,
  loginIpKey,
  LOGIN_IP_EMAIL_LIMIT,
  LOGIN_EMAIL_LIMIT,
} from "../auth-rate-limit";

// These exercise the failures-only login throttle's decision logic and keying,
// which is where the security property lives. The public async wrappers no-op
// under NODE_ENV=test (they need a request scope + Redis), so we test the pure
// pieces they compose.

describe("login throttle keying", () => {
  it("puts the attacker's IP in the (ip, email) key so a victim's key differs", () => {
    const email = "victim@example.com";
    const attackerKey = loginIpEmailKey("9.9.9.9", email);
    const victimKey = loginIpEmailKey("1.1.1.1", email);
    expect(attackerKey).not.toBe(victimKey);
  });

  it("normalizes the email in every key (case/whitespace insensitive)", () => {
    expect(loginEmailKey("  Victim@Example.com ")).toBe(loginEmailKey("victim@example.com"));
    expect(loginIpEmailKey("1.1.1.1", "A@B.com")).toBe(loginIpEmailKey("1.1.1.1", "a@b.com"));
  });

  it("keys the wide per-IP bucket on IP alone", () => {
    expect(loginIpKey("1.1.1.1")).not.toBe(loginIpKey("2.2.2.2"));
  });
});

describe("isLoginBlockedByCounts", () => {
  it("does NOT block a victim from a fresh IP after an attacker floods a different IP", () => {
    // Attacker sent LOGIN_IP_EMAIL_LIMIT failures from their own IP: their
    // (ip,email) bucket is full and the shared email bucket holds the same count.
    // The victim signs in from a DIFFERENT IP, so their (ip,email) count is 0 and
    // the email backstop (30) is far from tripped by 10 attempts.
    const attackerFailures = LOGIN_IP_EMAIL_LIMIT; // 10
    const victimBlocked = isLoginBlockedByCounts(
      attackerFailures, // shared email bucket
      0, // victim's own (ip, email) bucket — different key
      0, // victim's wide per-IP bucket
    );
    expect(victimBlocked).toBe(false);
  });

  it("blocks the attacker's own IP once its (ip, email) bucket is full", () => {
    expect(isLoginBlockedByCounts(LOGIN_IP_EMAIL_LIMIT, LOGIN_IP_EMAIL_LIMIT, 0)).toBe(true);
  });

  it("trips the email backstop against a distributed (many-IP) brute force", () => {
    // Each IP stays under the strict bucket, but the shared email counter reaches
    // the high backstop threshold.
    expect(isLoginBlockedByCounts(LOGIN_EMAIL_LIMIT, 0, 0)).toBe(true);
  });

  it("does not block below every threshold", () => {
    expect(
      isLoginBlockedByCounts(LOGIN_EMAIL_LIMIT - 1, LOGIN_IP_EMAIL_LIMIT - 1, 0),
    ).toBe(false);
  });
});
