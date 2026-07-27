import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { validateSummaryResult, MAX_SUMMARY_CHARS, MAX_BULLETS, MAX_BULLET_CHARS } from "./validator.js";

describe("validateSummaryResult", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("parses raw JSON", () => {
    expect(validateSummaryResult('{"summary":"Acme asks for the signed contract."}')).toEqual({
      format: "PROSE",
      text: "Acme asks for the signed contract.",
      bullets: [],
    });
  });

  it("parses a fenced JSON block", () => {
    const raw = '```json\n{"summary":"Invoice 42 is overdue."}\n```';
    expect(validateSummaryResult(raw)).toEqual({
      format: "PROSE",
      text: "Invoice 42 is overdue.",
      bullets: [],
    });
  });

  it("parses a JSON object surrounded by prose", () => {
    const raw = 'Here you go:\n{"summary":"Standup moved to 10am."}\nHope that helps.';
    expect(validateSummaryResult(raw)).toEqual({
      format: "PROSE",
      text: "Standup moved to 10am.",
      bullets: [],
    });
  });

  it("returns null when there is no JSON object", () => {
    expect(validateSummaryResult("I cannot summarize this.")).toBeNull();
  });

  it("returns null when neither shape is present", () => {
    expect(validateSummaryResult('{"text":"wrong key"}')).toBeNull();
    expect(validateSummaryResult('{"summary":""}')).toBeNull();
    expect(validateSummaryResult('{"bullets":[]}')).toBeNull();
  });

  it("returns null when the summary is only whitespace", () => {
    expect(validateSummaryResult('{"summary":"   \\n  "}')).toBeNull();
  });

  it("collapses whitespace", () => {
    expect(validateSummaryResult('{"summary":"  Two   lines\\nof  text.  "}')).toEqual({
      format: "PROSE",
      text: "Two lines of text.",
      bullets: [],
    });
  });

  it("caps the stored text at MAX_SUMMARY_CHARS", () => {
    const long = "a".repeat(MAX_SUMMARY_CHARS + 500);
    const result = validateSummaryResult(JSON.stringify({ summary: long }));
    expect(result?.text).toHaveLength(MAX_SUMMARY_CHARS);
  });

  // The summary IS derived email content, so a parse failure must never leak a
  // preview of the model output into the logs (stricter than the draft validator).
  it("never logs a preview of the raw output", () => {
    const secret = "CONFIDENTIAL patient record for John Doe";
    validateSummaryResult(secret);
    validateSummaryResult(JSON.stringify({ nope: secret }));
    for (const call of errorSpy.mock.calls) {
      expect(String(call[0])).not.toContain("CONFIDENTIAL");
      expect(String(call[0])).not.toContain("John Doe");
    }
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe("validateSummaryResult — bullets", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("parses the bullets shape", () => {
    const raw = '{"bullets":["Kabbalat Shabbat at 19:30","Bring documents for the door","Sacramento 1227"]}';
    expect(validateSummaryResult(raw)).toEqual({
      format: "BULLETS",
      text: null,
      bullets: ["Kabbalat Shabbat at 19:30", "Bring documents for the door", "Sacramento 1227"],
    });
  });

  it("caps the list at MAX_BULLETS", () => {
    const raw = JSON.stringify({ bullets: ["a", "b", "c", "d", "e"] });
    expect(validateSummaryResult(raw)?.bullets).toHaveLength(MAX_BULLETS);
  });

  it("caps each bullet at MAX_BULLET_CHARS", () => {
    const raw = JSON.stringify({ bullets: ["x".repeat(400), "y".repeat(400)] });
    for (const b of validateSummaryResult(raw)!.bullets) {
      expect(b).toHaveLength(MAX_BULLET_CHARS);
    }
  });

  it("strips a bullet glyph the model prefixed anyway and collapses whitespace", () => {
    const raw = JSON.stringify({ bullets: ["- first  item", "• second\nitem"] });
    expect(validateSummaryResult(raw)?.bullets).toEqual(["first item", "second item"]);
  });

  it("drops empty bullets", () => {
    const raw = JSON.stringify({ bullets: ["real", "   ", "", "also real"] });
    expect(validateSummaryResult(raw)?.bullets).toEqual(["real", "also real"]);
  });

  // A one-item list is a sentence wearing a costume; rendering a single bullet
  // looks broken in every surface.
  it("demotes a single bullet to prose", () => {
    expect(validateSummaryResult('{"bullets":["Only one fact here"]}')).toEqual({
      format: "PROSE",
      text: "Only one fact here",
      bullets: [],
    });
  });

  it("prefers bullets when the model sends both shapes", () => {
    const raw = JSON.stringify({ summary: "prose version", bullets: ["one", "two"] });
    const result = validateSummaryResult(raw);
    expect(result?.format).toBe("BULLETS");
    expect(result?.text).toBeNull();
  });

  it("falls back to prose when bullets is present but empty", () => {
    const raw = JSON.stringify({ summary: "prose version", bullets: [] });
    expect(validateSummaryResult(raw)).toEqual({
      format: "PROSE",
      text: "prose version",
      bullets: [],
    });
  });
});
