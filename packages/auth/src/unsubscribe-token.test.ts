import { describe, it, expect } from "vitest";
import { signUnsubscribeToken, verifyUnsubscribeToken } from "./unsubscribe-token.js";

describe("unsubscribe tokens", () => {
  it("verifies a token it signed for the same user", () => {
    const token = signUnsubscribeToken("user-1");
    expect(verifyUnsubscribeToken("user-1", token)).toBe(true);
  });

  it("rejects a token signed for a different user", () => {
    const token = signUnsubscribeToken("user-1");
    expect(verifyUnsubscribeToken("user-2", token)).toBe(false);
  });

  it("rejects a tampered token", () => {
    const token = signUnsubscribeToken("user-1");
    const tampered = `${token.slice(0, -1)}${token.endsWith("0") ? "1" : "0"}`;
    expect(verifyUnsubscribeToken("user-1", tampered)).toBe(false);
  });

  it("rejects garbage and empty input without throwing", () => {
    expect(verifyUnsubscribeToken("user-1", "")).toBe(false);
    expect(verifyUnsubscribeToken("user-1", "not-hex-zz")).toBe(false);
  });

  it("is deterministic for the same user", () => {
    expect(signUnsubscribeToken("user-1")).toBe(signUnsubscribeToken("user-1"));
  });
});
