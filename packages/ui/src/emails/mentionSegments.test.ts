import { describe, it, expect } from "vitest";
import { findMentionSegments } from "./mentionSegments.js";
import type { MemberItem } from "./types.js";

// This helper decides what counts as a tag, for both the composer's accent
// highlight and the mention ids sent on submit — the two must never disagree.

const MEMBERS: MemberItem[] = [
  { userId: "u-alice", name: "Alice", email: "alice@example.com" },
  { userId: "u-smith", name: "Alice Smith", email: "asmith@example.com" },
  { userId: "u-noname", name: null, email: "ops@example.com" },
];

function ids(text: string, members: MemberItem[] | null = MEMBERS): string[] {
  return findMentionSegments(text, members).map((s) => s.userId);
}

describe("findMentionSegments", () => {
  it("matches a member name at start, middle, and end of text", () => {
    expect(ids("@Alice can you look")).toEqual(["u-alice"]);
    expect(ids("can @Alice look")).toEqual(["u-alice"]);
    expect(ids("over to @Alice")).toEqual(["u-alice"]);
  });

  it("matches case-insensitively", () => {
    expect(ids("ping @alice")).toEqual(["u-alice"]);
    expect(ids("ping @ALICE SMITH")).toEqual(["u-smith"]);
  });

  it("prefers the longest label at a position", () => {
    expect(ids("@Alice Smith owns this")).toEqual(["u-smith"]);
  });

  it("falls back to the email label for members without a name", () => {
    expect(ids("cc @ops@example.com please")).toEqual(["u-noname"]);
  });

  it("requires a boundary before the @ so email addresses never match", () => {
    expect(ids("mail alice@example.com about it")).toEqual([]);
    expect(ids("hi@Alice")).toEqual([]);
  });

  it("requires a boundary after the label so partial words never match", () => {
    expect(ids("@Alicey")).toEqual([]);
    expect(ids("(@Alice)")).toEqual(["u-alice"]);
    expect(ids("ask @Alice, thanks")).toEqual(["u-alice"]);
  });

  it("finds every occurrence and reports exact offsets", () => {
    const text = "@Alice then @Bobby then @Alice";
    const segments = findMentionSegments(text, MEMBERS);
    expect(segments).toEqual([
      { start: 0, end: 6, userId: "u-alice" },
      { start: 24, end: 30, userId: "u-alice" },
    ]);
    expect(text.slice(segments[0]!.start, segments[0]!.end)).toBe("@Alice");
  });

  it("returns nothing for a null or empty member list", () => {
    expect(ids("@Alice", null)).toEqual([]);
    expect(ids("@Alice", [])).toEqual([]);
  });
});
