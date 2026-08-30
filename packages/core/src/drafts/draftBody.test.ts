import { describe, it, expect } from "vitest";
import { draftBodyToHtml } from "./draftBody.js";

describe("draftBodyToHtml", () => {
  it("wraps a single block in one paragraph", () => {
    expect(draftBodyToHtml("Thursday works for me.")).toBe("<p>Thursday works for me.</p>");
  });

  it("splits blank-line-separated blocks into paragraphs", () => {
    expect(draftBodyToHtml("Hi Ana,\n\nThursday works.\n\nBen")).toBe(
      "<p>Hi Ana,</p><p>Thursday works.</p><p>Ben</p>",
    );
  });

  it("keeps single newlines inside a block as line breaks", () => {
    expect(draftBodyToHtml("Ben Azlay\nAziru")).toBe("<p>Ben Azlay<br>Aziru</p>");
  });

  it("collapses runs of more than two newlines into one paragraph split", () => {
    expect(draftBodyToHtml("One\n\n\n\nTwo")).toBe("<p>One</p><p>Two</p>");
  });

  it("normalizes CRLF so a Windows-style body does not gain stray breaks", () => {
    expect(draftBodyToHtml("Hi,\r\n\r\nThanks.")).toBe("<p>Hi,</p><p>Thanks.</p>");
  });

  it("trims surrounding whitespace so insertion sits against the quoted trail", () => {
    expect(draftBodyToHtml("\n\n  Thanks.  \n\n")).toBe("<p>Thanks.</p>");
  });

  it("returns empty string for an empty or whitespace-only body", () => {
    expect(draftBodyToHtml("")).toBe("");
    expect(draftBodyToHtml("   \n\n  ")).toBe("");
  });

  describe("escaping — the body is model output going into a live mailbox", () => {
    it("escapes markup so it renders as text, never as HTML", () => {
      expect(draftBodyToHtml("<script>alert(1)</script>")).toBe(
        "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>",
      );
    });

    it("escapes ampersands and quotes", () => {
      expect(draftBodyToHtml(`Tom & "Jerry" & Co's`)).toBe(
        "<p>Tom &amp; &quot;Jerry&quot; &amp; Co&#39;s</p>",
      );
    });

    it("escapes before adding markup, so an ampersand cannot forge an entity", () => {
      expect(draftBodyToHtml("&lt;b&gt;")).toBe("<p>&amp;lt;b&amp;gt;</p>");
    });

    it("does not let a newline-adjacent tag escape its paragraph", () => {
      expect(draftBodyToHtml("a\n</p><p>b")).toBe("<p>a<br>&lt;/p&gt;&lt;p&gt;b</p>");
    });
  });
});
