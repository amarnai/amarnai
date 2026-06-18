import { describe, it, expect, vi } from "vitest";
import { sendExpoPushMessages, type ExpoPushMessage } from "../notifications/expo-push.js";

function msg(to: string): ExpoPushMessage {
  return { to, title: "t", body: "b" };
}

describe("sendExpoPushMessages", () => {
  it("returns [] and never calls fetch for an empty list", async () => {
    const fetchFn = vi.fn();
    const tickets = await sendExpoPushMessages([], { fetch: fetchFn as unknown as typeof fetch });
    expect(tickets).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("batches into 100-message requests", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: Array.from({ length: 100 }, () => ({ status: "ok" })) }),
    }));
    const messages = Array.from({ length: 250 }, (_, i) => msg(`tok-${i}`));
    const tickets = await sendExpoPushMessages(messages, { fetch: fetchFn as unknown as typeof fetch });
    expect(fetchFn).toHaveBeenCalledTimes(3); // 100 + 100 + 50
    expect(tickets).toHaveLength(250);
  });

  it("turns an HTTP error into per-message error tickets without throwing", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: false,
      status: 502,
      text: async () => "bad gateway",
    }));
    const tickets = await sendExpoPushMessages([msg("a"), msg("b")], {
      fetch: fetchFn as unknown as typeof fetch,
    });
    expect(tickets).toEqual([
      { status: "error", message: "HTTP 502" },
      { status: "error", message: "HTTP 502" },
    ]);
  });

  it("turns a network throw into per-message error tickets", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const tickets = await sendExpoPushMessages([msg("a")], {
      fetch: fetchFn as unknown as typeof fetch,
    });
    expect(tickets).toEqual([{ status: "error", message: "ECONNREFUSED" }]);
  });
});
