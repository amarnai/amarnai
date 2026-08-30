import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ApiClient } from "@aziru/api-client";
import { openWebApp } from "./openWebApp";

vi.mock("../config", () => ({
  WEB_APP_URL: "https://app.test",
  API_BASE_URL: "https://api.test",
}));

function makeApi(createBridgeCode: ApiClient["createBridgeCode"]): ApiClient {
  return { createBridgeCode } as unknown as ApiClient;
}

const openSpy = vi.fn();

beforeEach(() => {
  openSpy.mockReset();
  vi.stubGlobal("open", openSpy);
});

describe("openWebApp", () => {
  it("routes through the bridge with the minted code and destination", async () => {
    const api = makeApi(vi.fn().mockResolvedValue({ code: "abc123", expiresAt: "2026-01-01" }));

    await openWebApp(api, "/folders");

    expect(openSpy).toHaveBeenCalledWith(
      "https://app.test/auth/bridge?code=abc123&next=%2Ffolders",
      "_blank",
      "noopener"
    );
  });

  it("encodes a destination that carries a query string", async () => {
    const api = makeApi(vi.fn().mockResolvedValue({ code: "abc", expiresAt: "2026-01-01" }));

    await openWebApp(api, "/upgrade?ctx=collaborators");

    expect(openSpy.mock.calls[0]![0]).toBe(
      "https://app.test/auth/bridge?code=abc&next=%2Fupgrade%3Fctx%3Dcollaborators"
    );
  });

  it("falls back to the plain URL when the code cannot be minted", async () => {
    const api = makeApi(vi.fn().mockRejectedValue(new Error("offline")));

    await openWebApp(api, "/settings");

    // Worst case is the pre-bridge behaviour: the page opens and asks for a
    // sign-in, rather than nothing happening at all.
    expect(openSpy).toHaveBeenCalledWith("https://app.test/settings", "_blank", "noopener");
  });
});
