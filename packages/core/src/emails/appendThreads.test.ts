import { describe, it, expect } from "vitest";
import { appendThreads } from "./appendThreads.js";
import type { ThreadItem } from "./types.js";

function makeThread(id: string): ThreadItem {
  return {
    id,
    subject: id,
    providerThreadId: `g-${id}`,
    participants: "Someone",
    latestAt: new Date("2026-01-01T00:00:00.000Z"),
    messageCount: 1,
    snippet: "",
    unread: false,
    folderId: null,
    status: "unsorted",
    confidence: 0,
    reasoning: null,
    alternativeFolder: null,
    messages: [],
    hasDraft: false,
    isDrafting: false,
    lastSenderEmail: null,
    doneMark: null,
    assignment: null,
    isImportant: false,
    isClassifying: false,
    attachmentCount: 0,
  };
}

describe("appendThreads", () => {
  it("appends a next page after the existing list, preserving order", () => {
    const prev = [makeThread("a"), makeThread("b")];
    const next = [makeThread("c"), makeThread("d")];
    const result = appendThreads(prev, next);
    expect(result.map((t) => t.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("de-duplicates a thread that shifted across the page boundary", () => {
    const prev = [makeThread("a"), makeThread("b")];
    // "b" reappears at the top of the next page after newer threads pushed it down.
    const next = [makeThread("b"), makeThread("c")];
    const result = appendThreads(prev, next);
    expect(result.map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("keeps the existing copy when a duplicate id appears in the next page", () => {
    const prev = [makeThread("a")];
    const next = [{ ...makeThread("a"), subject: "changed" }];
    const result = appendThreads(prev, next);
    expect(result).toHaveLength(1);
    expect(result[0]!.subject).toBe("a");
  });

  it("returns the existing list unchanged when the next page is empty", () => {
    const prev = [makeThread("a")];
    expect(appendThreads(prev, [])).toEqual(prev);
  });
});
