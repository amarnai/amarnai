import { describe, it, expect } from "vitest";
import app from "../app.js";

describe("GET /health", () => {
  it("returns 200 with { ok: true }", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
