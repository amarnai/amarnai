import { describe, it, expect } from "vitest";
import { parseThreadEvent } from "./threadEvent.js";

// One bad frame must not tear down a live stream, and a server newer than this
// build may add event types we do not act on.
describe("parseThreadEvent", () => {
  it("parses a well-formed frame", () => {
    expect(
      parseThreadEvent('{"type":"quota_blocked","threadId":"t1","providerThreadId":"18f0"}'),
    ).toEqual({ type: "quota_blocked", threadId: "t1", providerThreadId: "18f0" });
  });

  it("returns null for malformed or unknown frames", () => {
    expect(parseThreadEvent("not json")).toBeNull();
    expect(parseThreadEvent("null")).toBeNull();
    expect(parseThreadEvent('{"type":"classified","threadId":"t1"}')).toBeNull();
    expect(
      parseThreadEvent('{"type":"invented_later","threadId":"t1","providerThreadId":"x"}'),
    ).toBeNull();
  });
});
