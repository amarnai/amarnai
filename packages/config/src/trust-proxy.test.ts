import { afterEach, describe, expect, it, vi } from "vitest";

// The config module validates process.env at import time, so each case loads a
// fresh copy under a controlled environment. Mirrors token-encryption-key.test.ts.
const VALID_KEY = "a".repeat(64);

// Everything else production requires, so TRUST_PROXY is what these cases turn on.
const PROD_BASE = {
  NODE_ENV: "production",
  INTERNAL_API_SECRET: "x",
  AUTH_JWT_SECRET: "y",
  TOKEN_ENCRYPTION_KEY: VALID_KEY,
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
  // Start from "no TRUST_PROXY in the environment" so the unset case is genuine.
  vi.stubEnv("TRUST_PROXY", undefined);
  for (const [key, value] of Object.entries(overrides)) {
    vi.stubEnv(key, value);
  }
  return import("./index.js");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("TRUST_PROXY validation", () => {
  it("throws in production when TRUST_PROXY is unset", async () => {
    await expect(loadConfig({ ...PROD_BASE })).rejects.toThrow(
      /TRUST_PROXY is required in production/,
    );
  });

  it("throws in production when TRUST_PROXY is empty (empty counts as unset)", async () => {
    // TRUST_PROXY= (a common compose/k8s state) must NOT coerce to 0 and slip past
    // the gate — the whole point of the empty-string preprocess.
    await expect(loadConfig({ ...PROD_BASE, TRUST_PROXY: "" })).rejects.toThrow(
      /TRUST_PROXY is required in production/,
    );
  });

  it("resolves an empty value to 0 outside production", async () => {
    const { config } = await loadConfig({ NODE_ENV: "development", TRUST_PROXY: "" });
    expect(config.authRateLimit.trustProxy).toBe(0);
  });

  it("accepts an explicit 0 in production (direct connections)", async () => {
    const { config } = await loadConfig({ ...PROD_BASE, TRUST_PROXY: "0" });
    expect(config.authRateLimit.trustProxy).toBe(0);
  });

  it("accepts a positive hop count in production", async () => {
    const { config } = await loadConfig({ ...PROD_BASE, TRUST_PROXY: "2" });
    expect(config.authRateLimit.trustProxy).toBe(2);
  });

  it("skips the gate during the Next.js build phase", async () => {
    const { config } = await loadConfig({
      ...PROD_BASE,
      NEXT_PHASE: "phase-production-build",
    });
    expect(config.authRateLimit.trustProxy).toBe(0);
  });

  it("resolves an unset value to 0 outside production", async () => {
    const { config } = await loadConfig({ NODE_ENV: "development" });
    expect(config.authRateLimit.trustProxy).toBe(0);
  });
});
