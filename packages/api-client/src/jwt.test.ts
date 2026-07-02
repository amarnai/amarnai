import { describe, it, expect } from "vitest";
import { readUserIdFromAccessToken } from "./jwt.js";

// Encode an object as a base64url JWT segment (no padding), the way a real
// issuer would. Buffer is only used in the test to build fixtures; the decoder
// under test is dependency-free.
function segment(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

// Assemble a token from a payload with a fixed header + dummy signature. The
// decoder ignores the header and signature, so their contents don't matter.
function tokenWith(payload: unknown): string {
  return `${segment({ alg: "HS256", typ: "JWT" })}.${segment(payload)}.c2ln`;
}

describe("readUserIdFromAccessToken", () => {
  it("returns the sub claim from a well-formed token", () => {
    expect(readUserIdFromAccessToken(tokenWith({ sub: "user_123" }))).toBe("user_123");
  });

  it("ignores other claims and reads only sub", () => {
    const token = tokenWith({ sub: "abc", email: "a@b.co", exp: 9999999999 });
    expect(readUserIdFromAccessToken(token)).toBe("abc");
  });

  it("decodes multi-byte UTF-8 sub values", () => {
    // Exercises the 2-byte (ü) and 4-byte (🚀) branches of the UTF-8 decoder.
    const sub = "üser-🚀-123";
    expect(readUserIdFromAccessToken(tokenWith({ sub }))).toBe(sub);
  });

  it("handles base64url payloads containing - and _ characters", () => {
    // Keep encoding until the payload segment uses both URL-safe glyphs, so the
    // '-'->'+' and '_'->'/' remap is actually covered.
    let sub = "";
    let seg = "";
    for (let n = 0; !(seg.includes("-") && seg.includes("_")); n++) {
      sub = `user~${n}~ÿÿ`;
      seg = segment({ sub });
    }
    expect(readUserIdFromAccessToken(tokenWith({ sub }))).toBe(sub);
  });

  it("returns null when the sub claim is missing", () => {
    expect(readUserIdFromAccessToken(tokenWith({ email: "a@b.co" }))).toBeNull();
  });

  it("returns null when sub is an empty string", () => {
    expect(readUserIdFromAccessToken(tokenWith({ sub: "" }))).toBeNull();
  });

  it("returns null when sub is not a string", () => {
    expect(readUserIdFromAccessToken(tokenWith({ sub: 42 }))).toBeNull();
    expect(readUserIdFromAccessToken(tokenWith({ sub: null }))).toBeNull();
  });

  it("returns null when the payload is not a JSON object", () => {
    expect(readUserIdFromAccessToken(tokenWith("just a string"))).toBeNull();
    expect(readUserIdFromAccessToken(tokenWith(["sub", "x"]))).toBeNull();
  });

  it("returns null for a token without exactly three segments", () => {
    expect(readUserIdFromAccessToken("")).toBeNull();
    expect(readUserIdFromAccessToken("onlyonepart")).toBeNull();
    expect(readUserIdFromAccessToken(`${segment({ sub: "x" })}.${segment({ sub: "x" })}`)).toBeNull();
    expect(readUserIdFromAccessToken("a.b.c.d")).toBeNull();
  });

  it("returns null when the payload segment is not valid JSON", () => {
    const badPayload = Buffer.from("not json {", "utf8").toString("base64url");
    expect(readUserIdFromAccessToken(`${segment({})}.${badPayload}.sig`)).toBeNull();
  });
});
