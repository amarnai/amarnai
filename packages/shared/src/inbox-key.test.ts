import { describe, expect, it } from "vitest";
import { normalizeInboxKey } from "./inbox-key.js";

describe("normalizeInboxKey", () => {
  it("lowercases and trims", () => {
    expect(normalizeInboxKey("  Ben@Gmail.com ")).toBe("ben@gmail.com");
  });

  it("strips dots from gmail.com local parts (Gmail ignores dots)", () => {
    expect(normalizeInboxKey("b.e.n@gmail.com")).toBe("ben@gmail.com");
    expect(normalizeInboxKey("ben@gmail.com")).toBe("ben@gmail.com");
  });

  it("drops +tag suffixes on gmail.com", () => {
    expect(normalizeInboxKey("ben+newsletters@gmail.com")).toBe("ben@gmail.com");
    expect(normalizeInboxKey("b.e.n+x@gmail.com")).toBe("ben@gmail.com");
  });

  it("canonicalizes googlemail.com to gmail.com", () => {
    expect(normalizeInboxKey("b.en@googlemail.com")).toBe("ben@gmail.com");
  });

  it("collapses dotted and plus variants to one key", () => {
    const a = normalizeInboxKey("ben@gmail.com");
    expect(normalizeInboxKey("b.e.n@gmail.com")).toBe(a);
    expect(normalizeInboxKey("ben+x@gmail.com")).toBe(a);
    expect(normalizeInboxKey("BEN+y@googlemail.com")).toBe(a);
  });

  it("drops +tag suffixes on non-gmail domains (every provider honors +tag)", () => {
    expect(normalizeInboxKey("user+1@outlook.com")).toBe("user@outlook.com");
    expect(normalizeInboxKey("user+2@outlook.com")).toBe("user@outlook.com");
    // The two +tag variants collapse to one identity — the anti-abuse anchor.
    expect(normalizeInboxKey("user+1@outlook.com")).toBe(normalizeInboxKey("user+2@outlook.com"));
    expect(normalizeInboxKey("ben+sales@acme.com")).toBe("ben@acme.com");
  });

  it("keeps dots significant on non-gmail domains (only Gmail ignores dots)", () => {
    expect(normalizeInboxKey("b.e.n@acme.com")).toBe("b.e.n@acme.com");
    // a.b@outlook.com stays distinct from ab@outlook.com...
    expect(normalizeInboxKey("a.b@outlook.com")).not.toBe(normalizeInboxKey("ab@outlook.com"));
    // ...but a.b@gmail.com === ab@gmail.com (Gmail-only dot collapsing).
    expect(normalizeInboxKey("a.b@gmail.com")).toBe(normalizeInboxKey("ab@gmail.com"));
  });

  it("is idempotent", () => {
    const once = normalizeInboxKey("B.e.N+tag@googlemail.com");
    expect(normalizeInboxKey(once)).toBe(once);
  });

  it("returns malformed input lowercased rather than throwing", () => {
    expect(normalizeInboxKey("not-an-email")).toBe("not-an-email");
    expect(normalizeInboxKey("@gmail.com")).toBe("@gmail.com");
    expect(normalizeInboxKey("ben@")).toBe("ben@");
  });
});
