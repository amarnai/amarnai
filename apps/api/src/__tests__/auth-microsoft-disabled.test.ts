import { vi, describe, it, expect } from "vitest";

// config.outlook.enabled is computed once at module init, so the "Outlook is not
// configured" case needs its own file: the credentials must be absent before the
// app (and @aziru/config) is imported.
vi.hoisted(() => {
  delete process.env["MS_GRAPH_CLIENT_ID"];
  delete process.env["MS_GRAPH_CLIENT_SECRET"];
});

vi.mock("@aziru/db", () => ({
  db: { user: { findUnique: vi.fn(async () => ({ sessionEpoch: 0 })) } },
  maybeCreateExtensionNudge: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@aziru/outlook", async (importActual) => {
  const actual = await importActual<typeof import("@aziru/outlook")>();
  return { ...actual, exchangeAuthCode: vi.fn(), fetchOutlookProfile: vi.fn() };
});

vi.mock("@aziru/auth", () => ({
  provisionMicrosoftUser: vi.fn(),
  provisionGoogleUser: vi.fn(),
  issueAccessToken: vi.fn(async () => "access-tok"),
  issueRefreshToken: vi.fn(async () => ({ token: "refresh-tok", expiresAt: new Date() })),
  verifyAccessToken: vi.fn(async () => null),
  verifyCredentials: vi.fn(),
  rotateRefreshToken: vi.fn(),
  revokeRefreshToken: vi.fn(),
  getOrCreateDefaultWorkspace: vi.fn(),
  StaleWhileErrorCache: class {
    async get(_k: string, loader: () => Promise<unknown>) {
      try {
        return { status: "loaded", value: await loader() };
      } catch {
        return { status: "unavailable", value: null };
      }
    }
    set() {}
    invalidate() {}
    clear() {}
  },
}));

vi.mock("../services/queue-client.js", () => ({
  syncInboxQueue: { add: vi.fn().mockResolvedValue({}) },
  backfillInboxQueue: { add: vi.fn().mockResolvedValue({}) },
}));

import app from "../app.js";
import { exchangeAuthCode } from "@aziru/outlook";
import { provisionMicrosoftUser } from "@aziru/auth";

describe("POST /auth/microsoft when Outlook is not configured", () => {
  it("404s without redeeming the code", async () => {
    const res = await app.request("/auth/microsoft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: "ms-code-123",
        scope: "Mail.Read offline_access User.Read",
        redirectUri: "https://abcdefghijklmnop.chromiumapp.org/",
      }),
    });

    expect(res.status).toBe(404);
    expect(exchangeAuthCode).not.toHaveBeenCalled();
    expect(provisionMicrosoftUser).not.toHaveBeenCalled();
  });
});
