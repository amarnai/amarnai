import { afterEach, describe, expect, it, vi } from "vitest";

// The config module validates process.env at import time, so each case loads a
// fresh copy under a controlled environment.
const VALID_KEY = "a".repeat(64);

// Secrets that are also required in production; set them so the token-key gate
// is what's under test rather than an earlier check.
const PROD_BASE = {
  NODE_ENV: "production",
  INTERNAL_API_SECRET: "x",
  AUTH_JWT_SECRET: "y",
} as const;

async function loadConfig(overrides: Record<string, string | undefined>) {
  vi.resetModules();
  for (const key of [
    "NODE_ENV",
    "TOKEN_ENCRYPTION_KEY",
    "INTERNAL_API_SECRET",
    "AUTH_JWT_SECRET",
    "NEXT_PHASE",
  ]) {
    vi.stubEnv(key, "");
  }
  // Satisfy the production TRUST_PROXY gate so it is not what these cases trip on
  // ("" coerces to 0, an explicit direct-connection topology).
  vi.stubEnv("TRUST_PROXY", "0");
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) vi.stubEnv(key, value);
  }
  return import("./index.js");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("TOKEN_ENCRYPTION_KEY validation", () => {
  it("throws in production when the key is missing", async () => {
    await expect(loadConfig({ ...PROD_BASE })).rejects.toThrow(
      /TOKEN_ENCRYPTION_KEY is required in production/,
    );
  });

  it("throws in production when the key is not 64 hex chars", async () => {
    await expect(
      loadConfig({ ...PROD_BASE, TOKEN_ENCRYPTION_KEY: "deadbeef" }),
    ).rejects.toThrow(/TOKEN_ENCRYPTION_KEY is required in production/);
  });

  it("accepts a valid 64-hex key in production", async () => {
    const { config } = await loadConfig({
      ...PROD_BASE,
      TOKEN_ENCRYPTION_KEY: VALID_KEY,
    });
    expect(config.tokenEncryptionKey).toBe(VALID_KEY);
  });

  it("skips the production gate during the Next.js build phase", async () => {
    const { config } = await loadConfig({
      ...PROD_BASE,
      NEXT_PHASE: "phase-production-build",
    });
    // Falls back to the dev default (unreachable at real runtime).
    expect(config.tokenEncryptionKey).toMatch(/^[0-9a-fA-F]{64}$/);
  });

  it("uses a valid dev default outside production", async () => {
    const { config } = await loadConfig({ NODE_ENV: "development" });
    expect(config.tokenEncryptionKey).toMatch(/^[0-9a-fA-F]{64}$/);
  });
});
