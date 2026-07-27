import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { validateSummaryResult, MAX_SUMMARY_CHARS } from "./validator.js";

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
      summary: "Acme asks for the signed contract.",
    });
  });

  it("parses a fenced JSON block", () => {
    const raw = '```json\n{"summary":"Invoice 42 is overdue."}\n```';
    expect(validateSummaryResult(raw)).toEqual({ summary: "Invoice 42 is overdue." });
  });

  it("parses a JSON object surrounded by prose", () => {
    const raw = 'Here you go:\n{"summary":"Standup moved to 10am."}\nHope that helps.';
    expect(validateSummaryResult(raw)).toEqual({ summary: "Standup moved to 10am." });
  });

  it("returns null when there is no JSON object", () => {
    expect(validateSummaryResult("I cannot summarize this.")).toBeNull();
  });

  it("returns null when the schema does not match", () => {
    expect(validateSummaryResult('{"text":"wrong key"}')).toBeNull();
    expect(validateSummaryResult('{"summary":""}')).toBeNull();
  });

  it("returns null when the summary is only whitespace", () => {
    expect(validateSummaryResult('{"summary":"   \\n  "}')).toBeNull();
  });

  it("collapses whitespace", () => {
    expect(validateSummaryResult('{"summary":"  Two   lines\\nof  text.  "}')).toEqual({
      summary: "Two lines of text.",
    });
  });

  it("caps the stored text at MAX_SUMMARY_CHARS", () => {
    const long = "a".repeat(MAX_SUMMARY_CHARS + 500);
    const result = validateSummaryResult(JSON.stringify({ summary: long }));
    expect(result?.summary).toHaveLength(MAX_SUMMARY_CHARS);
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
