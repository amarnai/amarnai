import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Control the key the encryption module reads without importing real config.
// Both the Gmail connect path (storeGmailConnection) and the Outlook connect
// path (storeOutlookConnection) call the SAME encrypt(), so exercising these
// functions directly covers token encryption for both providers.
const state = vi.hoisted(() => ({ keyHex: "a3f1c0de".repeat(8) }));
vi.mock("@aziru/config", () => ({
  config: {
    get tokenEncryptionKey() {
      return state.keyHex;
    },
  },
}));

import { decrypt, encrypt } from "./encryption.js";

const VALID_KEY = "a3f1c0de".repeat(8); // 64 hex chars

beforeEach(() => {
  state.keyHex = VALID_KEY;
});

describe("token encryption", () => {
  it("round-trips a refresh token with a configured key", () => {
    const plaintext = "1//refresh-token-value";
    const encrypted = encrypt(plaintext);
    expect(encrypted).not.toContain(plaintext);
    expect(decrypt(encrypted)).toBe(plaintext);
  });

  it("produces distinct ciphertexts for the same plaintext (random IV)", () => {
    const a = encrypt("same");
    const b = encrypt("same");
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe("same");
    expect(decrypt(b)).toBe("same");
  });

  it("rejects a tampered ciphertext (GCM auth tag)", () => {
    const encrypted = encrypt("secret");
    const [iv, tag, ct] = encrypted.split(":");
    const flipped = ct!.slice(0, -1) + (ct!.endsWith("0") ? "1" : "0");
    expect(() => decrypt([iv, tag, flipped].join(":"))).toThrow();
  });

  it("fails closed when the configured key is missing", () => {
    state.keyHex = "";
    expect(() => encrypt("x")).toThrow(/TOKEN_ENCRYPTION_KEY/);
    expect(() => decrypt("a:b:c")).toThrow(/TOKEN_ENCRYPTION_KEY/);
  });

  it("fails closed when the configured key is not 64 hex chars", () => {
    state.keyHex = "tooshort";
    expect(() => encrypt("x")).toThrow(/TOKEN_ENCRYPTION_KEY/);
  });

  it("has no source-derivable fallback key", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./encryption.ts", import.meta.url)),
      "utf8",
    );
    expect(source).not.toContain("amarnai-fallback");
    // AUTH_SECRET must not be part of the token-key derivation path.
    expect(source).not.toContain("AUTH_SECRET");
  });
});
