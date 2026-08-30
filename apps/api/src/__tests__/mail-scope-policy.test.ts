import { describe, it, expect } from "vitest";
import app from "../app.js";
import { config } from "@aziru/config";

/**
 * The one endpoint an OAuth client can call before it has a session, so the
 * assertions that matter are "reachable without a token" and "reports the flag".
 */
describe("GET /auth/mail-scope-policy", () => {
  it("answers without an Authorization header", async () => {
    // A client has no token at sign-in time. If this ever falls out of
    // PUBLIC_PATHS it 401s and every extension silently drops to read-only.
    const res = await app.request("/auth/mail-scope-policy");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      writebackAvailable: config.mail.labelWritebackEnabled,
    });
  });

  it("tracks the deployment's writeback flag", async () => {
    const original = config.mail.labelWritebackEnabled;
    try {
      (config.mail as { labelWritebackEnabled: boolean }).labelWritebackEnabled = true;
      let res = await app.request("/auth/mail-scope-policy");
      expect(await res.json()).toEqual({ writebackAvailable: true });

      (config.mail as { labelWritebackEnabled: boolean }).labelWritebackEnabled = false;
      res = await app.request("/auth/mail-scope-policy");
      expect(await res.json()).toEqual({ writebackAvailable: false });
    } finally {
      (config.mail as { labelWritebackEnabled: boolean }).labelWritebackEnabled = original;
    }
  });
});
