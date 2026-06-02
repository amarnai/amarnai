import { describe, it, expect } from "vitest";
import app from "../app.js";
import { INTERNAL_TOKEN } from "./helpers.js";

describe("internal auth middleware", () => {
  it("passes /health without an Authorization header", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
  });

  it("returns 401 for a protected route with no Authorization header", async () => {
    const res = await app.request("/workspaces");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 401 for a protected route with a wrong token", async () => {
    const res = await app.request("/workspaces", {
      headers: { Authorization: "Bearer wrong-secret" },
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 when the Authorization header is present but not a Bearer token", async () => {
    const res = await app.request("/workspaces", {
      headers: { Authorization: INTERNAL_TOKEN },
    });
    expect(res.status).toBe(401);
  });

  it("passes a protected route with the correct Bearer token", async () => {
    const res = await app.request("/workspaces", {
      headers: { Authorization: `Bearer ${INTERNAL_TOKEN}` },
    });
    // The workspaces route itself may return 500 in tests (no DB mock here),
    // but anything other than 401 proves the middleware accepted the token.
    expect(res.status).not.toBe(401);
  });
});
