import { describe, it, expect } from "vitest";
import { SSEParser } from "./parseSSE.js";

describe("SSEParser", () => {
  it("parses a single event with event + data fields", () => {
    const p = new SSEParser();
    const events = p.push("event: synced\ndata: ws-1\n\n");
    expect(events).toEqual([{ event: "synced", data: "ws-1" }]);
  });

  it("buffers a record split across chunk boundaries", () => {
    const p = new SSEParser();
    expect(p.push("event: syn")).toEqual([]);
    expect(p.push("ced\ndata: ws-1")).toEqual([]);
    expect(p.push("\n\n")).toEqual([{ event: "synced", data: "ws-1" }]);
  });

  it("returns multiple events from a single chunk", () => {
    const p = new SSEParser();
    const events = p.push("event: connected\ndata: ws-1\n\nevent: synced\ndata: ws-1\n\n");
    expect(events).toEqual([
      { event: "connected", data: "ws-1" },
      { event: "synced", data: "ws-1" },
    ]);
  });

  it("tolerates CRLF line endings", () => {
    const p = new SSEParser();
    const events = p.push("event: synced\r\ndata: ws-1\r\n\r\n");
    expect(events).toEqual([{ event: "synced", data: "ws-1" }]);
  });

  it("strips a single leading space after the field colon", () => {
    const p = new SSEParser();
    // "data:ws-1" (no space) and "data: ws-1" (one space) both yield "ws-1".
    expect(p.push("event:synced\ndata:ws-1\n\n")).toEqual([{ event: "synced", data: "ws-1" }]);
  });

  it("ignores comment lines (heartbeat padding)", () => {
    const p = new SSEParser();
    const events = p.push(": keep-alive\n\nevent: synced\ndata: ws-1\n\n");
    // The comment-only record yields nothing; only the real event is returned.
    expect(events).toEqual([{ event: "synced", data: "ws-1" }]);
  });
});
