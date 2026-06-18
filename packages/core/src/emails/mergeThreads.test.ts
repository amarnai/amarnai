import { describe, it, expect } from "vitest";
import { mergeThreads } from "./mergeThreads.js";
import type { ThreadItem } from "./types.js";

function makeThread(id: string, overrides: Partial<ThreadItem> = {}): ThreadItem {
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
    isImportant: false,
    isClassifying: false,
    ...overrides,
  };
}

describe("mergeThreads", () => {
  it("passes through a brand-new server thread unchanged", () => {
    const fresh = [makeThread("a")];
    const merged = mergeThreads(fresh, [], null);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.id).toBe("a");
  });

  it("preserves local isDrafting when the server has not yet committed the draft", () => {
    const prev = [makeThread("a", { isDrafting: true })];
    const fresh = [makeThread("a", { isDrafting: false, hasDraft: false })];
    const merged = mergeThreads(fresh, prev, null);
    expect(merged[0]!.isDrafting).toBe(true);
  });

  it("clears isDrafting once the server confirms the draft is proposed", () => {
    const prev = [makeThread("a", { isDrafting: true })];
    const fresh = [makeThread("a", { isDrafting: false, hasDraft: true })];
    const merged = mergeThreads(fresh, prev, null);
    expect(merged[0]!.isDrafting).toBe(false);
    expect(merged[0]!.hasDraft).toBe(true);
  });

  it("keeps hasDraft sticky when the local copy already has a draft", () => {
    const prev = [makeThread("a", { hasDraft: true })];
    const fresh = [makeThread("a", { hasDraft: false })];
    const merged = mergeThreads(fresh, prev, null);
    expect(merged[0]!.hasDraft).toBe(true);
  });

  it("re-inserts the pinned selected thread when the server dropped it (pagination)", () => {
    const prev = [makeThread("a"), makeThread("pinned")];
    const fresh = [makeThread("a")];
    const merged = mergeThreads(fresh, prev, "pinned");
    expect(merged.map((t) => t.id)).toContain("pinned");
  });

  it("does not duplicate the pinned thread when it is still present", () => {
    const prev = [makeThread("pinned")];
    const fresh = [makeThread("pinned")];
    const merged = mergeThreads(fresh, prev, "pinned");
    expect(merged.filter((t) => t.id === "pinned")).toHaveLength(1);
  });
});
