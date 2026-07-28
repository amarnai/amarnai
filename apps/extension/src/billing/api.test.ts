import { describe, it, expect, vi, beforeEach } from "vitest";
import { startCheckout, confirmCheckout } from "./api";

vi.mock("../config", () => ({
  WEB_APP_URL: "https://app.test",
  API_BASE_URL: "https://api.test",
}));

vi.mock("../auth/tokenStore", () => ({
  extensionTokenStore: {
    get: vi.fn(),
    set: vi.fn(),
    clear: vi.fn(),
  },
}));

import { extensionTokenStore } from "../auth/tokenStore";

function textResponse(status: number, body: string): Response {
  return { ok: status >= 200 && status < 300, status, text: async () => body } as Response;
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.mocked(extensionTokenStore.get).mockResolvedValue({
    accessToken: "tok",
    refreshToken: "ref",
    refreshTokenExpiresAt: "2030-01-01T00:00:00.000Z",
  });
});

describe("startCheckout", () => {
  it("posts to the web app's billing route with the panel's bearer token", async () => {
    fetchMock.mockResolvedValue(
      textResponse(200, JSON.stringify({ url: "https://stripe.test/c", sessionId: "cs_1" }))
    );

    const res = await startCheckout({ action: "upgrade", plan: "pro", cycle: "monthly" });

    expect(res).toEqual({
      ok: true,
      status: 200,
      data: { url: "https://stripe.test/c", sessionId: "cs_1" },
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://app.test/api/billing/create-checkout-session");
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body)).toEqual({ action: "upgrade", plan: "pro", cycle: "monthly" });
  });

  it("omits the header rather than sending an empty one when signed out", async () => {
    vi.mocked(extensionTokenStore.get).mockResolvedValue(null);
    fetchMock.mockResolvedValue(textResponse(401, JSON.stringify({ error: "Unauthorized" })));

    await startCheckout({ action: "upgrade", plan: "pro", cycle: "monthly" });

    expect(fetchMock.mock.calls[0]![1].headers.Authorization).toBeUndefined();
  });

  it("survives the non-JSON 500 an unconfigured Stripe returns", async () => {
    fetchMock.mockResolvedValue(textResponse(500, "Internal Server Error"));

    const res = await startCheckout({ action: "upgrade", plan: "pro", cycle: "monthly" });

    expect(res.ok).toBe(false);
    expect(res.status).toBe(500);
    expect(res.data).toEqual({});
  });
});

describe("confirmCheckout", () => {
  it("reports a checkout that has not finished paying yet", async () => {
    fetchMock.mockResolvedValue(textResponse(200, JSON.stringify({ pending: true })));

    const res = await confirmCheckout("cs_1");

    expect(res.data.pending).toBe(true);
    expect(fetchMock.mock.calls[0]![0]).toBe("https://app.test/api/billing/confirm-checkout");
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ sessionId: "cs_1" });
  });
});
