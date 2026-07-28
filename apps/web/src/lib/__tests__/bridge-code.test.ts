import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { inspectBridgeCode, redeemBridgeCode } from "@/lib/bridge-code";

const ORIGINAL_ENV = { ...process.env };

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  process.env.API_URL = "https://api.test";
  process.env.INTERNAL_API_SECRET = "internal-secret";
  vi.restoreAllMocks();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("redeemBridgeCode", () => {
  it("calls the API with the internal secret and returns the identity", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { userId: "u-1", email: "a@b.com", emailVerified: true })
      );
    vi.stubGlobal("fetch", fetchMock);

    expect(await redeemBridgeCode("raw")).toEqual({
      userId: "u-1",
      email: "a@b.com",
      emailVerified: true,
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.test/auth/bridge/redeem");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer internal-secret"
    );
    expect(JSON.parse(init.body as string)).toEqual({ code: "raw" });
  });

  it("returns null when the API rejects the code", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(401, { error: "nope" })));

    expect(await redeemBridgeCode("raw")).toBeNull();
  });

  it("returns null when the API is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    expect(await redeemBridgeCode("raw")).toBeNull();
  });

  it("returns null on a malformed payload rather than a partial identity", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { userId: 42 })));

    expect(await redeemBridgeCode("raw")).toBeNull();
  });

  it("returns null when the server is not configured to reach the API", async () => {
    delete process.env.INTERNAL_API_SECRET;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await redeemBridgeCode("raw")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("inspectBridgeCode", () => {
  it("hits the inspect endpoint, which does not spend the code", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { userId: "u-2", email: "c@d.com", emailVerified: false })
      );
    vi.stubGlobal("fetch", fetchMock);

    expect(await inspectBridgeCode("raw")).toEqual({
      userId: "u-2",
      email: "c@d.com",
      emailVerified: false,
    });
    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.test/auth/bridge/inspect");
  });
});
