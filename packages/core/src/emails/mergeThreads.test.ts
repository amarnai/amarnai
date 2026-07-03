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
    assignment: null,
    isImportant: false,
    isClassifying: false,
    attachmentCount: 0,
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

  it("keeps already-loaded later pages when a refresh only returns page 1", () => {
    // The list has been paginated to two pages; a refresh re-fetches only the
    // first-page window (a, b). The later-page threads (c, d) must survive.
    const prev = [makeThread("a"), makeThread("b"), makeThread("c"), makeThread("d")];
    const fresh = [makeThread("a"), makeThread("b")];
    const merged = mergeThreads(fresh, prev, null, true);
    expect(merged.map((t) => t.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("merges status updates from page 1 without dropping later pages", () => {
    const prev = [
      makeThread("a", { status: "unsorted" }),
      makeThread("c", { status: "unsorted" }),
    ];
    // Page 1 now reports "a" as sorted; "c" lives on a later page and is absent.
    const fresh = [makeThread("a", { status: "sorted" })];
    const merged = mergeThreads(fresh, prev, null, true);
    expect(merged.find((t) => t.id === "a")!.status).toBe("sorted");
    expect(merged.find((t) => t.id === "c")).toBeDefined();
  });

  it("surfaces a newly-arrived page-1 thread ahead of later pages", () => {
    const prev = [makeThread("b"), makeThread("c")];
    // A brand-new thread "a" arrived at the top of page 1.
    const fresh = [makeThread("a"), makeThread("b")];
    const merged = mergeThreads(fresh, prev, null, true);
    expect(merged.map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("drops a removed thread on a non-paginated refresh (straight replace)", () => {
    // No pagination (keepTail defaults to false): a thread the server no longer
    // returns — e.g. it was trashed and filtered out — must disappear.
    const prev = [makeThread("a"), makeThread("trashed")];
    const fresh = [makeThread("a")];
    const merged = mergeThreads(fresh, prev, null);
    expect(merged.map((t) => t.id)).toEqual(["a"]);
  });
});
