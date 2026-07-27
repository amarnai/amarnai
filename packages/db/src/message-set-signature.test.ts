import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { messageSetSignature } from "./message-set-signature.js";

describe("messageSetSignature", () => {
  it("is order-independent", () => {
    expect(messageSetSignature(["c", "a", "b"])).toBe(messageSetSignature(["a", "b", "c"]));
  });

  it("changes when a message is added or removed", () => {
    const base = messageSetSignature(["a", "b"]);
    expect(messageSetSignature(["a", "b", "c"])).not.toBe(base);
    expect(messageSetSignature(["a"])).not.toBe(base);
  });

  it("returns 16 hex chars", () => {
    expect(messageSetSignature(["a"])).toMatch(/^[0-9a-f]{16}$/);
  });

  it("handles the empty set", () => {
    expect(messageSetSignature([])).toMatch(/^[0-9a-f]{16}$/);
  });

  it("does not mutate the input array", () => {
    const ids = ["c", "a", "b"];
    messageSetSignature(ids);
    expect(ids).toEqual(["c", "a", "b"]);
  });

  // Pinned vector: locks byte-compatibility with the original module-local copy in
  // sync-inbox.ts. If this changes, every in-flight LIVE classify dedup key changes
  // with it — the value is part of a persisted contract, not an implementation detail.
  it("matches the pinned sha1-16 of the sorted, comma-joined ids", () => {
    const ids = ["msg-3", "msg-1", "msg-2"];
    const expected = createHash("sha1").update("msg-1,msg-2,msg-3").digest("hex").slice(0, 16);
    expect(messageSetSignature(ids)).toBe(expected);
    expect(messageSetSignature(ids)).toBe("82028e05cd063b42");
  });
});
