import { describe, it, expect, beforeEach, vi } from "vitest";
import { handleInjectPageWorld, isInjectPageWorldRequest } from "./pageWorldHandler";

// The failure mode this handler exists to prevent is silence: without it,
// InboxSDK.load() waits forever for the pageWorld handshake and the reply
// button simply never appears. So the tests pin the exact contract the SDK
// depends on — MAIN world, the pageWorld.js file, the sender's tab, and a
// truthy answer only when injection actually ran.

const executeScript = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  executeScript.mockResolvedValue([{}]);
  (globalThis.chrome as unknown as Record<string, unknown>)["scripting"] = { executeScript };
});

describe("isInjectPageWorldRequest", () => {
  it("matches the SDK's exact message type", () => {
    expect(isInjectPageWorldRequest({ type: "inboxsdk__injectPageWorld" })).toBe(true);
  });

  it("ignores everything else on the bus", () => {
    expect(isInjectPageWorldRequest({ type: "aziru:generateDraft" })).toBe(false);
    expect(isInjectPageWorldRequest(null)).toBe(false);
    expect(isInjectPageWorldRequest("inboxsdk__injectPageWorld")).toBe(false);
  });
});

describe("handleInjectPageWorld", () => {
  it("injects pageWorld.js into the sender tab's MAIN world and answers true", async () => {
    await expect(handleInjectPageWorld(42)).resolves.toBe(true);
    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 42 },
      world: "MAIN",
      files: ["pageWorld.js"],
    });
  });

  it("answers false without a sender tab (the SDK treats falsy as not-injected)", async () => {
    await expect(handleInjectPageWorld(undefined)).resolves.toBe(false);
    expect(executeScript).not.toHaveBeenCalled();
  });

  it("answers false when injection fails, rather than leaving the SDK hanging", async () => {
    executeScript.mockRejectedValue(new Error("No tab with id"));
    await expect(handleInjectPageWorld(42)).resolves.toBe(false);
  });

  it("answers false when chrome.scripting is unavailable", async () => {
    delete (globalThis.chrome as unknown as Record<string, unknown>)["scripting"];
    await expect(handleInjectPageWorld(42)).resolves.toBe(false);
  });
});
