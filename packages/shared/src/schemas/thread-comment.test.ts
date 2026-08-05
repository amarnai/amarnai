import { describe, expect, it } from "vitest";
import {
  CreateThreadCommentSchema,
  MAX_COMMENT_LENGTH,
  MAX_MENTIONS_PER_COMMENT,
} from "./thread-comment.js";

describe("CreateThreadCommentSchema", () => {
  it("parses a minimal valid input and defaults mentions to empty", () => {
    const result = CreateThreadCommentSchema.parse({ body: "Looks good to me" });
    expect(result.body).toBe("Looks good to me");
    expect(result.mentionUserIds).toEqual([]);
  });

  it("trims the body", () => {
    const result = CreateThreadCommentSchema.parse({ body: "  hello  " });
    expect(result.body).toBe("hello");
  });

  it("rejects an empty or whitespace-only body", () => {
    expect(() => CreateThreadCommentSchema.parse({ body: "" })).toThrow();
    expect(() => CreateThreadCommentSchema.parse({ body: "   " })).toThrow();
  });

  it("accepts a body at exactly the maximum length", () => {
    const body = "a".repeat(MAX_COMMENT_LENGTH);
    expect(CreateThreadCommentSchema.parse({ body }).body).toBe(body);
  });

  it("rejects a body over the maximum length", () => {
    const body = "a".repeat(MAX_COMMENT_LENGTH + 1);
    expect(() => CreateThreadCommentSchema.parse({ body })).toThrow();
  });

  it("accepts mentions up to the cap", () => {
    const mentionUserIds = Array.from({ length: MAX_MENTIONS_PER_COMMENT }, (_, i) => `user_${i}`);
    const result = CreateThreadCommentSchema.parse({ body: "hi", mentionUserIds });
    expect(result.mentionUserIds).toHaveLength(MAX_MENTIONS_PER_COMMENT);
  });

  it("rejects more mentions than the cap", () => {
    const mentionUserIds = Array.from(
      { length: MAX_MENTIONS_PER_COMMENT + 1 },
      (_, i) => `user_${i}`,
    );
    expect(() => CreateThreadCommentSchema.parse({ body: "hi", mentionUserIds })).toThrow();
  });

  it("rejects empty-string mention ids", () => {
    expect(() =>
      CreateThreadCommentSchema.parse({ body: "hi", mentionUserIds: [""] }),
    ).toThrow();
  });
});
