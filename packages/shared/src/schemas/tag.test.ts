import { describe, expect, it } from "vitest";
import { CreateTagInputSchema, TagSourceSchema } from "./tag.js";

describe("TagSourceSchema", () => {
  it("accepts valid sources", () => {
    expect(TagSourceSchema.parse("GENIZOR")).toBe("GENIZOR");
    expect(TagSourceSchema.parse("GMAIL")).toBe("GMAIL");
  });

  it("rejects invalid values", () => {
    expect(() => TagSourceSchema.parse("OUTLOOK")).toThrow();
    expect(() => TagSourceSchema.parse("")).toThrow();
  });
});

describe("CreateTagInputSchema", () => {
  const minimal = {
    workspaceId: "ws_1",
    name: "Receipts",
    source: "GENIZOR" as const,
  };

  it("parses a minimal valid input", () => {
    const result = CreateTagInputSchema.parse(minimal);
    expect(result.name).toBe("Receipts");
    expect(result.source).toBe("GENIZOR");
  });

  it("accepts a valid hex color", () => {
    const result = CreateTagInputSchema.parse({ ...minimal, color: "#a3b4c5" });
    expect(result.color).toBe("#a3b4c5");
  });

  it("accepts uppercase hex color", () => {
    const result = CreateTagInputSchema.parse({ ...minimal, color: "#FF0000" });
    expect(result.color).toBe("#FF0000");
  });

  it("rejects invalid hex color", () => {
    expect(() =>
      CreateTagInputSchema.parse({ ...minimal, color: "red" })
    ).toThrow();
    expect(() =>
      CreateTagInputSchema.parse({ ...minimal, color: "#gg0000" })
    ).toThrow();
    expect(() =>
      CreateTagInputSchema.parse({ ...minimal, color: "#12345" })
    ).toThrow();
  });

  it("rejects empty name", () => {
    expect(() => CreateTagInputSchema.parse({ ...minimal, name: "" })).toThrow();
  });

  it("rejects name that is too long", () => {
    expect(() =>
      CreateTagInputSchema.parse({ ...minimal, name: "a".repeat(51) })
    ).toThrow();
  });

  it("rejects missing workspaceId", () => {
    expect(() =>
      CreateTagInputSchema.parse({ name: "Test", source: "GENIZOR" })
    ).toThrow();
  });
});
