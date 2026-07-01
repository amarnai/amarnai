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

  it("preserves dots and plus on custom domains (dots are significant there)", () => {
    expect(normalizeInboxKey("b.e.n@acme.com")).toBe("b.e.n@acme.com");
    expect(normalizeInboxKey("ben+sales@acme.com")).toBe("ben+sales@acme.com");
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
