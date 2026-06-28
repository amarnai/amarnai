import { describe, it, expect } from "vitest";
import {
  cosineSimilarity,
  meanVector,
  subtractVector,
  softmax,
  buildNodeEmbeddingText,
  buildThreadEmbeddingText,
  cleanForEmbedding,
  THREAD_EMBEDDING_CHAR_BUDGET,
  hashEmbeddingInput,
  computeSubtreeScores,
  deriveBreadcrumb,
  findDescendants,
  getStaleEmbeddableNodes,
} from "../embedding/math.js";
import type { TaxonomyEdgeInput } from "../types.js";
import type { EmbeddableNode } from "../embedding/types.js";

// ─── cosineSimilarity ─────────────────────────────────────────────────────────

describe("cosineSimilarity", () => {
  it("identical unit vectors → 1", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
  });

  it("antiparallel unit vectors → -1", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
  });

  it("perpendicular vectors → 0", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it("zero vector → 0", () => {
    expect(cosineSimilarity([0, 0, 0], [1, 0, 0])).toBe(0);
    expect(cosineSimilarity([1, 0, 0], [0, 0, 0])).toBe(0);
    expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
  });

  it("empty vectors → 0", () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it("mismatched lengths → 0", () => {
    expect(cosineSimilarity([1, 0], [1, 0, 0])).toBe(0);
  });

  it("non-unit vectors have the same similarity as their normalised forms", () => {
    expect(cosineSimilarity([2, 0], [3, 0])).toBeCloseTo(1);
  });

  it("45-degree vectors → ~0.707", () => {
    const a = [1, 0];
    const b = [1, 1];
    expect(cosineSimilarity(a, b)).toBeCloseTo(Math.SQRT1_2, 5);
  });
});

// ─── meanVector / subtractVector ───────────────────────────────────────────────

describe("meanVector", () => {
  it("empty input → []", () => {
    expect(meanVector([])).toEqual([]);
  });

  it("element-wise centroid of equal-length vectors", () => {
    expect(meanVector([[0, 0], [2, 4], [4, 8]])).toEqual([2, 4]);
  });

  it("single vector → itself", () => {
    expect(meanVector([[1, 2, 3]])).toEqual([1, 2, 3]);
  });

  it("skips vectors whose length differs from the first", () => {
    expect(meanVector([[2, 2], [4, 4], [1, 2, 3]])).toEqual([3, 3]);
  });
});

describe("subtractVector", () => {
  it("element-wise difference", () => {
    expect(subtractVector([5, 7, 9], [1, 2, 3])).toEqual([4, 5, 6]);
  });

  it("empty subtrahend → returns a unchanged (no-op)", () => {
    expect(subtractVector([1, 2], [])).toEqual([1, 2]);
  });

  it("length mismatch → returns a unchanged (no-op)", () => {
    expect(subtractVector([1, 2, 3], [1, 2])).toEqual([1, 2, 3]);
  });

  it("centering increases the margin between two anisotropic vectors", () => {
    // Two near-parallel unit-ish vectors sharing a large common component.
    const common = [10, 10, 10];
    const a = [10, 11, 10]; // leans dim 1
    const b = [10, 10, 11]; // leans dim 2
    const q = [10, 10.6, 10.4]; // closer to a
    const rawMargin = cosineSimilarity(q, a) - cosineSimilarity(q, b);
    const centroid = meanVector([a, b]);
    void common;
    const cenMargin =
      cosineSimilarity(subtractVector(q, centroid), subtractVector(a, centroid)) -
      cosineSimilarity(subtractVector(q, centroid), subtractVector(b, centroid));
    expect(cenMargin).toBeGreaterThan(rawMargin);
  });
});

// ─── softmax ──────────────────────────────────────────────────────────────────

describe("softmax", () => {
  it("probabilities sum to 1", () => {
    const p = softmax([0.8, 0.3, 0.5], 0.15);
    const sum = p.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1);
  });

  it("higher score receives higher probability", () => {
    const p = softmax([0.9, 0.4, 0.2], 0.15);
    expect(p[0]).toBeGreaterThan(p[1]!);
    expect(p[1]).toBeGreaterThan(p[2]!);
  });

  it("equal scores → uniform distribution", () => {
    const p = softmax([0.5, 0.5, 0.5], 0.15);
    expect(p[0]).toBeCloseTo(1 / 3);
    expect(p[1]).toBeCloseTo(1 / 3);
    expect(p[2]).toBeCloseTo(1 / 3);
  });

  it("single score → [1.0]", () => {
    expect(softmax([0.7], 0.15)).toEqual([1]);
  });

  it("empty array → []", () => {
    expect(softmax([], 0.15)).toEqual([]);
  });

  it("lower temperature sharpens the distribution", () => {
    const hot = softmax([0.8, 0.6], 0.5);
    const cold = softmax([0.8, 0.6], 0.05);
    expect(cold[0]! - cold[1]!).toBeGreaterThan(hot[0]! - hot[1]!);
  });
});

// ─── buildNodeEmbeddingText ────────────────────────────────────────────────────

describe("buildNodeEmbeddingText", () => {
  it("output contains Path:, Name:, and Description: lines", () => {
    const text = buildNodeEmbeddingText({
      name: "Billing",
      description: "Invoice processing and payment management.",
      breadcrumb: "Inbox > Billing",
    });
    expect(text).toContain("Path: Inbox > Billing");
    expect(text).toContain("Name: Billing");
    expect(text).toContain("Description: Invoice processing and payment management.");
  });

  it("breadcrumb appears on the first line prefixed with 'Path:'", () => {
    const text = buildNodeEmbeddingText({
      name: "Legal",
      description: "Contract review and compliance inquiries.",
      breadcrumb: "Inbox > Support > Legal",
    });
    const lines = text.split("\n");
    expect(lines[0]).toBe("Path: Inbox > Support > Legal");
    expect(lines[1]).toBe("Name: Legal");
    expect(lines[2]).toBe("Description: Contract review and compliance inquiries.");
  });

  it("all three fields are present in the output", () => {
    const text = buildNodeEmbeddingText({
      name: "Press",
      description: "Media and press relations.",
      breadcrumb: "Inbox > Press",
    });
    expect(text).toMatch(/Path:/);
    expect(text).toMatch(/Name:/);
    expect(text).toMatch(/Description:/);
  });

  it("is deterministic for identical inputs", () => {
    const node = { name: "Legal", description: "Contract review and compliance inquiries.", breadcrumb: "Inbox > Legal" };
    expect(buildNodeEmbeddingText(node)).toBe(buildNodeEmbeddingText(node));
  });

  it("different breadcrumbs produce different text", () => {
    const base = { name: "Node", description: "A description." };
    const t1 = buildNodeEmbeddingText({ ...base, breadcrumb: "Inbox > Node" });
    const t2 = buildNodeEmbeddingText({ ...base, breadcrumb: "Inbox > Parent > Node" });
    expect(t1).not.toBe(t2);
  });
});

// ─── buildThreadEmbeddingText ─────────────────────────────────────────────────

describe("buildThreadEmbeddingText", () => {
  it("includes subject from first message", () => {
    const text = buildThreadEmbeddingText([
      { subject: "My Subject", bodyText: "hello" },
    ]);
    expect(text).toContain("Subject: My Subject");
  });

  it("includes body excerpts", () => {
    const text = buildThreadEmbeddingText([
      { subject: "S", bodyText: "body text here" },
    ]);
    expect(text).toContain("body text here");
  });

  it("does not blindly truncate at 500 chars — uses full budget", () => {
    // Single message body of 1000 chars (well within the 3600-char latest budget).
    const long = "x".repeat(1000);
    const text = buildThreadEmbeddingText([{ subject: null, bodyText: long }]);
    // The entire body must appear — no early truncation.
    expect(text).toContain(long);
  });

  it("truncates with … marker when body exceeds latestBudget (60% of THREAD_EMBEDDING_CHAR_BUDGET)", () => {
    const latestBudget = Math.floor(THREAD_EMBEDDING_CHAR_BUDGET * 0.6); // 3600
    const long = "a".repeat(latestBudget + 200);
    const text = buildThreadEmbeddingText([{ subject: null, bodyText: long }]);
    expect(text).toContain(" … ");
    expect(text.length).toBeLessThan(long.length);
  });

  it("handles empty message list", () => {
    expect(buildThreadEmbeddingText([])).toBe("");
  });

  it("handles null subject and body", () => {
    const text = buildThreadEmbeddingText([{ subject: null, bodyText: null }]);
    expect(text).toBe("");
  });

  it("includes attachment filenames when body is absent", () => {
    const text = buildThreadEmbeddingText([
      { subject: null, bodyText: null, attachmentNames: ["facture.pdf"] },
    ]);
    expect(text).toContain("Attachments: facture.pdf");
  });

  it("attachment-only email: empty subject + no body + one attachment → non-empty text", () => {
    const text = buildThreadEmbeddingText([
      { subject: "", bodyText: null, attachmentNames: ["invoice_2026.pdf"] },
    ]);
    expect(text.trim()).not.toBe("");
    expect(text).toContain("invoice_2026.pdf");
  });

  it("empty subject + no body + no attachments → empty text (triggers needs-review guard)", () => {
    const text = buildThreadEmbeddingText([{ subject: "", bodyText: null }]);
    expect(text).toBe("");
  });

  it("multi-message thread: attachment filenames included for latest and earlier messages", () => {
    const text = buildThreadEmbeddingText([
      { subject: "Docs", bodyText: null, attachmentNames: ["contract.docx"] },
      { subject: "Re: Docs", bodyText: null, attachmentNames: ["signed_contract.pdf"] },
    ]);
    expect(text).toContain("Attachments: signed_contract.pdf");
    expect(text).toContain("Attachments: contract.docx");
  });

  it("multiple filenames are joined with comma-space", () => {
    const text = buildThreadEmbeddingText([
      { subject: null, bodyText: null, attachmentNames: ["a.pdf", "b.xlsx"] },
    ]);
    expect(text).toContain("Attachments: a.pdf, b.xlsx");
  });

  it("single-message thread: no labels added (backward-compatible format)", () => {
    const text = buildThreadEmbeddingText([{ subject: "S", bodyText: "just one message" }]);
    expect(text).not.toContain("[LATEST MESSAGE");
    expect(text).not.toContain("[EARLIER THREAD CONTEXT");
    expect(text).toContain("just one message");
  });

  it("multi-message thread: latest message appears first with primary-signal label", () => {
    const text = buildThreadEmbeddingText([
      { subject: "Original", bodyText: "earlier content here" },
      { subject: "Re: Original", bodyText: "latest content here" },
    ]);
    expect(text).toContain("[LATEST MESSAGE — primary classification signal]");
    expect(text).toContain("latest content here");
    expect(text).toContain("[EARLIER THREAD CONTEXT — secondary]");
    expect(text).toContain("earlier content here");
    // Latest appears before earlier in the combined text
    expect(text.indexOf("latest content here")).toBeLessThan(text.indexOf("earlier content here"));
  });

  it("multi-message thread: subject always comes from the first message", () => {
    const text = buildThreadEmbeddingText([
      { subject: "Original Subject", bodyText: "older body" },
      { subject: "Re: Original Subject", bodyText: "newer body" },
    ]);
    expect(text).toContain("Subject: Original Subject");
  });

  it("multi-message thread: bodies use budget allocation, not a 500-char cap", () => {
    // Two messages each 1000 chars — well within both the latest (3600) and
    // earlier (2400 total, 2400 for 1 message) budget slices.
    const long = "y".repeat(1000);
    const text = buildThreadEmbeddingText([
      { subject: null, bodyText: long },
      { subject: null, bodyText: long },
    ]);
    // Both full bodies must appear unchanged.
    const count = (text.match(/y{1000}/g) ?? []).length;
    expect(count).toBe(2);
  });
});

// ─── cleanForEmbedding ────────────────────────────────────────────────────────

describe("cleanForEmbedding", () => {
  // ── Passthrough ─────────────────────────────────────────────────────────────

  it("plain text with no boilerplate passes through unchanged", () => {
    const body = "We would like to request enterprise pricing for our team.";
    expect(cleanForEmbedding(body)).toBe(body);
  });

  it("empty string returns empty string", () => {
    expect(cleanForEmbedding("")).toBe("");
  });

  it("whitespace-only string returns empty string after trim", () => {
    expect(cleanForEmbedding("   \n\n   ")).toBe("");
  });

  // ── Quoted reply blocks ──────────────────────────────────────────────────────

  it("strips lines beginning with '>'", () => {
    const body = "Our main concern is pricing.\n> That sounds good.\n> Let me know.";
    const cleaned = cleanForEmbedding(body);
    expect(cleaned).toContain("Our main concern is pricing.");
    expect(cleaned).not.toContain("> That sounds good.");
    expect(cleaned).not.toContain("> Let me know.");
  });

  it("strips nested quoted lines (>> …)", () => {
    const body = "Reply here.\n>> deeply quoted\n> outer quote";
    const cleaned = cleanForEmbedding(body);
    expect(cleaned).not.toContain(">>");
    expect(cleaned).not.toContain("> outer");
  });

  it("does not strip lines where '>' is not the first character", () => {
    const body = "Price is > $100 per seat.";
    expect(cleanForEmbedding(body)).toContain("Price is > $100 per seat.");
  });

  it("strips 'On … wrote:' attribution and everything after it", () => {
    const body =
      "Please see my reply below.\n\nOn Mon, Jan 1, 2024 at 12:00 PM Jane Doe <jane@example.com> wrote:\n\nOriginal email content.";
    const cleaned = cleanForEmbedding(body);
    expect(cleaned).toContain("Please see my reply below.");
    expect(cleaned).not.toContain("Jane Doe");
    expect(cleaned).not.toContain("Original email content");
  });

  it("strips multi-line wrapped 'On … wrote:' attribution", () => {
    const body =
      "My reply is below.\n\nOn Monday, 1 January 2024 at 12:00:00 UTC, John Smith\n<john@example.com> wrote:\n\nQuoted original.";
    const cleaned = cleanForEmbedding(body);
    expect(cleaned).toContain("My reply is below.");
    expect(cleaned).not.toContain("John Smith");
    expect(cleaned).not.toContain("Quoted original");
  });

  // ── Email signatures ─────────────────────────────────────────────────────────

  it("strips everything after an RFC 3676 '-- ' delimiter", () => {
    const body = "Please find the details below.\n-- \nJohn Smith\nSenior Engineer\njohn@example.com";
    const cleaned = cleanForEmbedding(body);
    expect(cleaned).toContain("Please find the details below.");
    expect(cleaned).not.toContain("John Smith");
    expect(cleaned).not.toContain("Senior Engineer");
  });

  it("strips everything after '-- ' (no trailing space variant)", () => {
    const body = "Message body here.\n--\nSignature text.";
    const cleaned = cleanForEmbedding(body);
    expect(cleaned).toContain("Message body here.");
    expect(cleaned).not.toContain("Signature text.");
  });

  it("strips sign-off phrase and name when ≤ 4 lines remain", () => {
    const body = "We look forward to your response.\n\nBest regards,\nJane";
    const cleaned = cleanForEmbedding(body);
    expect(cleaned).toContain("We look forward to your response.");
    expect(cleaned).not.toContain("Best regards");
    expect(cleaned).not.toContain("Jane");
  });

  it("does NOT strip sign-off phrase when many lines of content follow it (mid-email)", () => {
    // "Thanks," appears early; 10 paragraphs of real content come after it.
    // lines.length − signoffIdx > 5 → not treated as a sign-off.
    const lines = ["Thanks,", "Alice", ""];
    for (let i = 0; i < 10; i++) lines.push(`Paragraph ${i} with additional content.`);
    const body = lines.join("\n");
    const cleaned = cleanForEmbedding(body);
    // Both the "sign-off" and subsequent content should be preserved.
    expect(cleaned).toContain("Thanks,");
    expect(cleaned).toContain("Paragraph 9 with additional content.");
  });

  it("handles 'Thanks' sign-off at end", () => {
    const body = "Let us know if you need anything else.\n\nThanks,\nBob";
    const cleaned = cleanForEmbedding(body);
    expect(cleaned).not.toContain("Thanks,");
    expect(cleaned).not.toContain("Bob");
    expect(cleaned).toContain("Let us know if you need anything else.");
  });

  // ── Tracking/footer URLs ────────────────────────────────────────────────────

  it("strips lines that are nothing but an http URL", () => {
    const body = "Click here to unsubscribe:\nhttp://example.com/unsubscribe?token=abc123\nThanks.";
    const cleaned = cleanForEmbedding(body);
    expect(cleaned).toContain("Click here to unsubscribe:");
    expect(cleaned).not.toContain("http://example.com/unsubscribe");
    expect(cleaned).toContain("Thanks.");
  });

  it("strips lines that are nothing but an https URL", () => {
    const body = "View in browser:\nhttps://mail.example.com/view?id=xyz\nMain content here.";
    const cleaned = cleanForEmbedding(body);
    expect(cleaned).not.toContain("https://mail.example.com");
    expect(cleaned).toContain("Main content here.");
  });

  it("does NOT strip URLs embedded mid-sentence", () => {
    const body = "See our docs at https://example.com/docs for more details.";
    expect(cleanForEmbedding(body)).toContain("See our docs at https://example.com/docs");
  });

  // ── Whitespace normalisation ────────────────────────────────────────────────

  it("collapses 3+ consecutive blank lines to one blank line", () => {
    const body = "First paragraph.\n\n\n\nSecond paragraph.";
    const cleaned = cleanForEmbedding(body);
    expect(cleaned).not.toMatch(/\n{3,}/);
    expect(cleaned).toContain("First paragraph.");
    expect(cleaned).toContain("Second paragraph.");
  });

  it("trims leading and trailing whitespace", () => {
    const body = "\n\n  Some content here.  \n\n";
    expect(cleanForEmbedding(body)).toBe("Some content here.");
  });

  // ── Language-neutral reply-tail stripping ────────────────────────────────────

  it("strips a French 'a écrit :' attribution + quoted tail", () => {
    const body =
      "Pouvez-vous confirmer le tarif entreprise ?\n\nLe lun. 1 janv. 2024 à 12:00, Jean Dupont <jean@example.com> a écrit :\n> Bonjour, voici notre devis initial.\n> Cordialement, Jean";
    const cleaned = cleanForEmbedding(body);
    expect(cleaned).toContain("Pouvez-vous confirmer le tarif entreprise ?");
    expect(cleaned).not.toContain("Jean Dupont");
    expect(cleaned).not.toContain("devis initial");
  });

  it("strips a German 'schrieb …:' attribution + quoted tail", () => {
    const body =
      "Können Sie uns ein Angebot zusenden?\n\nAm 1. Januar 2024 um 12:00 schrieb Anna Müller <anna@example.com>:\n> Hallo, anbei unser erstes Angebot.\n> Mit freundlichen Grüßen, Anna";
    const cleaned = cleanForEmbedding(body);
    expect(cleaned).toContain("Können Sie uns ein Angebot zusenden?");
    expect(cleaned).not.toContain("Anna Müller");
    expect(cleaned).not.toContain("erstes Angebot");
  });

  it("strips a Japanese '書きました:' attribution + quoted tail", () => {
    const body =
      "見積もりの確認をお願いします。\n\n2024年1月1日 12:00 田中太郎 <tanaka@example.com> が書きました:\n> こんにちは、最初の見積もりをお送りします。\n> よろしくお願いいたします。";
    const cleaned = cleanForEmbedding(body);
    expect(cleaned).toContain("見積もりの確認をお願いします。");
    expect(cleaned).not.toContain("田中太郎");
    expect(cleaned).not.toContain("最初の見積もり");
  });

  it("strips an unquoted reply tail (attribution → end, no '>' markers)", () => {
    const body =
      "My reply is below.\n\nLe lun. 1 janv. 2024 à 12:00, Jean\n<jean@example.com> a écrit :\n\nContenu original sans guillemets.";
    const cleaned = cleanForEmbedding(body);
    expect(cleaned).toContain("My reply is below.");
    expect(cleaned).not.toContain("Jean");
    expect(cleaned).not.toContain("Contenu original");
  });

  // ── Inline-quote preservation (the key conservative guarantee) ───────────────

  it("preserves an inline quote when the author's own text follows it", () => {
    const body =
      "Regarding your point below:\n> we should increase the budget\nI agree — let's allocate more for Q2.";
    const cleaned = cleanForEmbedding(body);
    expect(cleaned).toContain("we should increase the budget");
    expect(cleaned).toContain("I agree");
    expect(cleaned).toContain("Q2");
  });

  it("preserves an inline quote but still strips the trailing reply chain", () => {
    const body =
      "I disagree with this:\n> your quoted point\nHere's why: it costs too much.\n\nOn Mon, Jan 1 2024, Bob <bob@example.com> wrote:\n> the entire previous email\n> more of the previous email";
    const cleaned = cleanForEmbedding(body);
    // Inline quotation + author text kept.
    expect(cleaned).toContain("your quoted point");
    expect(cleaned).toContain("Here's why: it costs too much.");
    // Redundant reply tail removed.
    expect(cleaned).not.toContain("Bob");
    expect(cleaned).not.toContain("entire previous email");
  });

  // ── False-positive guards ────────────────────────────────────────────────────

  it("does NOT treat a mid-body colon line with an email as an attribution", () => {
    // No date → not an attribution header; the content after it must survive.
    const body =
      "I forwarded your message to support@acme.com:\nPlease help this customer with their billing issue.";
    const cleaned = cleanForEmbedding(body);
    expect(cleaned).toContain("support@acme.com");
    expect(cleaned).toContain("Please help this customer with their billing issue.");
  });

  it("does NOT absorb a plain colon intro line above a quoted block", () => {
    // "Here are the three options:" carries no email/date, so it is kept even
    // though a quoted block follows it.
    const body = "Here are the three options:\n> option A\n> option B";
    const cleaned = cleanForEmbedding(body);
    expect(cleaned).toContain("Here are the three options:");
    expect(cleaned).not.toContain("option A");
  });

  // ── Determinism / idempotency ────────────────────────────────────────────────

  it("is idempotent — clean(clean(x)) === clean(x)", () => {
    const body =
      "Final answer here.\n\nLe lun. 1 janv. 2024 à 12:00, Jean <jean@example.com> a écrit :\n> quoted\n\nBest regards,\nBob";
    const once = cleanForEmbedding(body);
    expect(cleanForEmbedding(once)).toBe(once);
  });

  it("is deterministic — repeated calls yield identical output", () => {
    const body = "Content.\n> trailing quote\n> more";
    expect(cleanForEmbedding(body)).toBe(cleanForEmbedding(body));
  });
});

// ─── buildThreadEmbeddingText — budget allocation ─────────────────────────────

describe("buildThreadEmbeddingText — budget allocation", () => {
  const LATEST_BUDGET = Math.floor(THREAD_EMBEDDING_CHAR_BUDGET * 0.6); // 3600
  const EARLIER_BUDGET = THREAD_EMBEDDING_CHAR_BUDGET - LATEST_BUDGET;  // 2400

  it("single short message: included as-is (no truncation)", () => {
    const body = "Short body.";
    const text = buildThreadEmbeddingText([{ subject: null, bodyText: body }]);
    expect(text).toContain(body);
    expect(text).not.toContain(" … ");
  });

  it("single message at exactly the latest budget: no truncation", () => {
    const body = "a".repeat(LATEST_BUDGET);
    const text = buildThreadEmbeddingText([{ subject: null, bodyText: body }]);
    expect(text).not.toContain(" … ");
    expect(text).toContain(body);
  });

  it("single long message (> latestBudget): truncated with … marker using 70/30 split", () => {
    const body = "a".repeat(LATEST_BUDGET + 500);
    const text = buildThreadEmbeddingText([{ subject: null, bodyText: body }]);
    expect(text).toContain(" … ");
    // Head: first 70% of budget; tail: last 30%
    const headLen = Math.floor(LATEST_BUDGET * 0.7);
    const tailLen = LATEST_BUDGET - headLen;
    expect(text).toContain("a".repeat(headLen));
    expect(text.endsWith("a".repeat(tailLen))).toBe(true);
  });

  it("many short messages: all included without truncation", () => {
    // 12 messages × 100 chars = 1200 chars total < 2400 earlier budget → all fit
    const msgs = Array.from({ length: 12 }, (_, i) => ({
      subject: null,
      bodyText: `message ${i} with some content here.`,
    }));
    const text = buildThreadEmbeddingText(msgs);
    // All 11 earlier messages are kept (12th is "latest")
    for (let i = 0; i < 11; i++) {
      expect(text).toContain(`message ${i} with some content here.`);
    }
    expect(text).not.toContain(" … ");
  });

  it("many long messages: latest gets latestBudget, each earlier gets earlierBudget/N share", () => {
    // 3 messages each 1500 chars — latest gets 3600, each earlier gets 2400/2 = 1200
    const body = "b".repeat(1500);
    const msgs = [
      { subject: null, bodyText: body },
      { subject: null, bodyText: body },
      { subject: null, bodyText: body },
    ];
    const text = buildThreadEmbeddingText(msgs);
    // Latest (1500 chars) fits within 3600 → no truncation for latest
    // Each earlier gets 2400/2 = 1200 chars → 1500 > 1200 → truncated with …
    const earlierBudgetPer = Math.floor(EARLIER_BUDGET / 2);
    expect(earlierBudgetPer).toBe(1200);
    // The text should contain at least one … (from truncated earlier messages)
    expect(text).toContain(" … ");
    // Latest body (1500 < 3600) should appear intact once
    expect(text.indexOf("b".repeat(1500))).not.toBe(-1);
  });

  it("too many messages: oldest are dropped, newest earlier messages kept", () => {
    // 14 messages: 1 latest + 13 earlier.
    // 2400 / 13 ≈ 184 < MIN_EARLIER_MSG_CHARS (200) → drop oldest until ≥ 200.
    // Drop 1 oldest → 12 earlier → 2400/12 = 200 ≥ 200 → stop.
    const msgs = Array.from({ length: 14 }, (_, i) => ({
      subject: null,
      bodyText: `unique-body-${i}`,
    }));
    const text = buildThreadEmbeddingText(msgs);
    // The oldest earlier message (index 0) should be dropped.
    expect(text).not.toContain("unique-body-0");
    // Newer earlier messages should still appear.
    expect(text).toContain("unique-body-1");
    expect(text).toContain("unique-body-12"); // second-to-last = newest earlier
    // Latest (index 13) always appears.
    expect(text).toContain("unique-body-13");
  });

  it("single earlier message gets full 40% budget (not split further)", () => {
    // 2 messages: latest + 1 earlier. Earlier gets full 2400 chars.
    const body = "c".repeat(EARLIER_BUDGET + 100); // 2500 chars > 2400
    const msgs = [
      { subject: null, bodyText: body },  // earlier
      { subject: null, bodyText: "latest" },
    ];
    const text = buildThreadEmbeddingText(msgs);
    // Earlier body exceeds 2400 → must be truncated
    expect(text).toContain(" … ");
    // Head of earlier body (70% of 2400 = 1680 chars)
    const headLen = Math.floor(EARLIER_BUDGET * 0.7);
    expect(text).toContain("c".repeat(headLen));
  });

  it("predominantly-CJK body uses a smaller effective budget than Latin", () => {
    // 2,000 chars: Latin (< latestBudget 3600) is kept intact; CJK is scaled to
    // 0.4 × 3600 = 1440 and therefore truncated, so dense scripts stay within the
    // embedding model's token limit instead of being silently over-truncated.
    const cjkBody = "顧".repeat(2000);
    const latinBody = "a".repeat(2000);
    const cjkText = buildThreadEmbeddingText([{ subject: null, bodyText: cjkBody }]);
    const latinText = buildThreadEmbeddingText([{ subject: null, bodyText: latinBody }]);
    expect(latinText).not.toContain(" … ");
    expect(cjkText).toContain(" … ");
  });
});

// ─── hashEmbeddingInput ───────────────────────────────────────────────────────

describe("hashEmbeddingInput", () => {
  it("same text and model → same hash", () => {
    expect(hashEmbeddingInput("foo", "model-a")).toBe(hashEmbeddingInput("foo", "model-a"));
  });

  it("different text → different hash", () => {
    expect(hashEmbeddingInput("foo", "model-a")).not.toBe(hashEmbeddingInput("bar", "model-a"));
  });

  it("different model → different hash", () => {
    expect(hashEmbeddingInput("foo", "model-a")).not.toBe(hashEmbeddingInput("foo", "model-b"));
  });

  it("produces a 64-char hex string (SHA-256)", () => {
    const h = hashEmbeddingInput("text", "model");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("old format (name\\ndescription) produces a different hash than new format", () => {
    const name = "Billing";
    const description = "Invoice processing and payment management.";
    const oldText = `${name}\n${description}`;
    const newText = buildNodeEmbeddingText({
      name,
      description,
      breadcrumb: "Inbox > Billing",
    });
    expect(hashEmbeddingInput(oldText, "model-v1")).not.toBe(
      hashEmbeddingInput(newText, "model-v1")
    );
  });
});

// ─── deriveBreadcrumb ─────────────────────────────────────────────────────────

describe("deriveBreadcrumb", () => {
  const INBOX = { id: "inbox", name: "Inbox", isRoot: true };
  const SUPPORT = { id: "support", name: "Support", isRoot: false };
  const BILLING = { id: "billing", name: "Billing", isRoot: false };

  const nodes = [INBOX, SUPPORT, BILLING];
  const edges: TaxonomyEdgeInput[] = [
    { id: "e1", sourceNodeId: "inbox", targetNodeId: "support" },
    { id: "e2", sourceNodeId: "support", targetNodeId: "billing" },
  ];

  it("root node returns just its own name", () => {
    expect(deriveBreadcrumb("inbox", nodes, edges)).toBe("Inbox");
  });

  it("direct child of root returns 'Root > Child'", () => {
    expect(deriveBreadcrumb("support", nodes, edges)).toBe("Inbox > Support");
  });

  it("grandchild returns full three-level path", () => {
    expect(deriveBreadcrumb("billing", nodes, edges)).toBe("Inbox > Support > Billing");
  });

  it("node absent from all edges returns just its own name", () => {
    const orphan = { id: "orphan", name: "Orphan", isRoot: false };
    expect(deriveBreadcrumb("orphan", [...nodes, orphan], edges)).toBe("Orphan");
  });

  it("node not in node list returns empty string (unknown node)", () => {
    expect(deriveBreadcrumb("ghost", nodes, edges)).toBe("");
  });

  it("does not infinite-loop on a cycle", () => {
    const cycleEdges: TaxonomyEdgeInput[] = [
      { id: "c1", sourceNodeId: "a", targetNodeId: "b" },
      { id: "c2", sourceNodeId: "b", targetNodeId: "a" }, // cycle
    ];
    const cycleNodes = [
      { id: "a", name: "A", isRoot: false },
      { id: "b", name: "B", isRoot: false },
    ];
    // Should return something without hanging
    const result = deriveBreadcrumb("b", cycleNodes, cycleEdges);
    expect(typeof result).toBe("string");
  });

  it("is deterministic for identical inputs", () => {
    expect(deriveBreadcrumb("billing", nodes, edges)).toBe(
      deriveBreadcrumb("billing", nodes, edges)
    );
  });
});

// ─── findDescendants ──────────────────────────────────────────────────────────

describe("findDescendants", () => {
  //   root → A → A1
  //               └─ A2
  //        → B
  const edges: TaxonomyEdgeInput[] = [
    { id: "e-r-a", sourceNodeId: "root", targetNodeId: "A" },
    { id: "e-r-b", sourceNodeId: "root", targetNodeId: "B" },
    { id: "e-a-a1", sourceNodeId: "A", targetNodeId: "A1" },
    { id: "e-a-a2", sourceNodeId: "A", targetNodeId: "A2" },
  ];

  it("leaf node (no children) returns []", () => {
    expect(findDescendants("B", edges)).toEqual([]);
    expect(findDescendants("A1", edges)).toEqual([]);
  });

  it("node with one child returns [childId]", () => {
    expect(findDescendants("B", edges)).toEqual([]);
    // A has two children
    const desc = findDescendants("A", edges);
    expect(desc).toContain("A1");
    expect(desc).toContain("A2");
    expect(desc).toHaveLength(2);
  });

  it("root returns all four descendants", () => {
    const desc = findDescendants("root", edges);
    expect(desc).toContain("A");
    expect(desc).toContain("B");
    expect(desc).toContain("A1");
    expect(desc).toContain("A2");
    expect(desc).toHaveLength(4);
  });

  it("does not include nodeId itself", () => {
    const desc = findDescendants("root", edges);
    expect(desc).not.toContain("root");

    const descA = findDescendants("A", edges);
    expect(descA).not.toContain("A");
  });

  it("disconnected node returns []", () => {
    expect(findDescendants("ghost", edges)).toEqual([]);
  });

  it("handles empty edge list", () => {
    expect(findDescendants("any", [])).toEqual([]);
  });
});

// ─── computeSubtreeScores ─────────────────────────────────────────────────────

describe("computeSubtreeScores", () => {
  const edges: TaxonomyEdgeInput[] = [
    { id: "e-root-A", sourceNodeId: "root", targetNodeId: "A" },
    { id: "e-root-B", sourceNodeId: "root", targetNodeId: "B" },
    { id: "e-A-A1", sourceNodeId: "A", targetNodeId: "A1" },
    { id: "e-A-A2", sourceNodeId: "A", targetNodeId: "A2" },
  ];

  it("leaf node gets its raw similarity", () => {
    const rawSims = new Map([["A1", 0.8], ["A2", 0.2], ["B", 0.3], ["A", 0.1]]);
    const scores = computeSubtreeScores("root", rawSims, edges, 0.95);
    expect(scores.get("A1")).toBeCloseTo(0.8);
    expect(scores.get("B")).toBeCloseTo(0.3);
  });

  it("parent score = max(rawSim, decay * maxChildScore)", () => {
    const rawSims = new Map([["A1", 0.8], ["A2", 0.2], ["B", 0.3], ["A", 0.1]]);
    const scores = computeSubtreeScores("root", rawSims, edges, 0.95);
    expect(scores.get("A")).toBeCloseTo(0.76);
  });

  it("large subtree does not dominate: max not sum", () => {
    const rawSims = new Map([["A1", 0.8], ["A2", 0.7], ["B", 0.75], ["A", 0.0]]);
    const scores = computeSubtreeScores("root", rawSims, edges, 0.95);
    expect(scores.get("A")).toBeCloseTo(0.76);
    expect(scores.get("B")).toBeCloseTo(0.75);
    expect(scores.get("A")! - scores.get("B")!).toBeLessThan(0.1);
  });

  it("root node has no rawSim but gets score via children", () => {
    const rawSims = new Map([["A1", 0.8], ["A2", 0.2], ["B", 0.3], ["A", 0.1]]);
    const scores = computeSubtreeScores("root", rawSims, edges, 0.95);
    expect(scores.get("root")).toBeCloseTo(0.722);
  });

  it("decay factor propagates correctly across multiple levels", () => {
    const rawSims = new Map([["A1", 1.0], ["A2", 0.0], ["B", 0.0], ["A", 0.0]]);
    const scores = computeSubtreeScores("root", rawSims, edges, 0.5);
    expect(scores.get("A")).toBeCloseTo(0.5);
    expect(scores.get("root")).toBeCloseTo(0.25);
  });

  it("missing rawSim defaults to 0 (root has none)", () => {
    const rawSims = new Map([["A1", 0.6]]);
    const scores = computeSubtreeScores("root", rawSims, edges, 0.95);
    expect(scores.get("A2")).toBeCloseTo(0);
  });

  it("handles a single-node tree (no edges)", () => {
    const scores = computeSubtreeScores("solo", new Map([["solo", 0.5]]), [], 0.95);
    expect(scores.get("solo")).toBeCloseTo(0.5);
  });
});

// ─── getStaleEmbeddableNodes ──────────────────────────────────────────────────

describe("getStaleEmbeddableNodes", () => {
  const MODEL = "test-model-v1";

  const INBOX: EmbeddableNode = {
    id: "inbox", name: "Inbox", description: null, instructions: null, examples: [], isRoot: true,
  };
  const ALPHA: EmbeddableNode = {
    id: "alpha", name: "Alpha", description: "Administrative coordination.", instructions: null,
    examples: [], isRoot: false,
  };
  const BETA: EmbeddableNode = {
    id: "beta", name: "Beta", description: "Sales inquiries and business development.", instructions: null,
    examples: [], isRoot: false,
  };

  const nodes = [INBOX, ALPHA, BETA];
  const edges: TaxonomyEdgeInput[] = [
    { id: "e1", sourceNodeId: "inbox", targetNodeId: "alpha" },
    { id: "e2", sourceNodeId: "inbox", targetNodeId: "beta" },
  ];

  function freshHash(node: EmbeddableNode): string {
    const breadcrumb = `Inbox > ${node.name}`;
    const text = buildNodeEmbeddingText({ name: node.name, description: node.description!, breadcrumb });
    return hashEmbeddingInput(text, MODEL);
  }

  it("returns all non-root nodes when none have embeddings", () => {
    const stale = getStaleEmbeddableNodes(nodes, edges, MODEL);
    expect(stale.map((n) => n.id)).toContain("alpha");
    expect(stale.map((n) => n.id)).toContain("beta");
    expect(stale.map((n) => n.id)).not.toContain("inbox");
  });

  it("skips root nodes regardless of their embedding state", () => {
    const inboxWithEmbedding: EmbeddableNode = {
      ...INBOX,
      embeddingVector: [0.1, 0.2],
      embeddingModel: MODEL,
      embeddingTextHash: "some-hash",
    };
    const stale = getStaleEmbeddableNodes([inboxWithEmbedding, ALPHA], edges, MODEL);
    expect(stale.map((n) => n.id)).not.toContain("inbox");
  });

  it("skips nodes without a description", () => {
    const noDesc: EmbeddableNode = {
      id: "nodesc", name: "NoDesc", description: null, instructions: null, examples: [], isRoot: false,
    };
    const stale = getStaleEmbeddableNodes([noDesc], edges, MODEL);
    expect(stale).toHaveLength(0);
  });

  it("returns empty when all embeddings are current", () => {
    const freshAlpha: EmbeddableNode = {
      ...ALPHA, embeddingVector: [0.1, 0.2], embeddingModel: MODEL, embeddingTextHash: freshHash(ALPHA),
    };
    const freshBeta: EmbeddableNode = {
      ...BETA, embeddingVector: [0.3, 0.4], embeddingModel: MODEL, embeddingTextHash: freshHash(BETA),
    };
    const stale = getStaleEmbeddableNodes([INBOX, freshAlpha, freshBeta], edges, MODEL);
    expect(stale).toHaveLength(0);
  });

  it("detects nodes with wrong model as stale", () => {
    const wrongModel: EmbeddableNode = {
      ...ALPHA,
      embeddingVector: [0.1, 0.2],
      embeddingModel: "old-model",
      embeddingTextHash: freshHash(ALPHA), // hash is for right format but wrong model
    };
    const stale = getStaleEmbeddableNodes([INBOX, wrongModel], edges, MODEL);
    expect(stale.map((n) => n.id)).toContain("alpha");
  });

  it("detects nodes with empty vector as stale (missing embedding)", () => {
    const emptyVec: EmbeddableNode = {
      ...ALPHA, embeddingVector: [], embeddingModel: MODEL, embeddingTextHash: freshHash(ALPHA),
    };
    const stale = getStaleEmbeddableNodes([INBOX, emptyVec], edges, MODEL);
    expect(stale.map((n) => n.id)).toContain("alpha");
  });

  it("old-format hashes (name\\ndescription only) are detected as stale", () => {
    // Pre-path-aware format: "Alpha\nAdministrative coordination."
    const oldText = `${ALPHA.name}\n${ALPHA.description}`;
    const oldHash = hashEmbeddingInput(oldText, MODEL);
    const oldFormatNode: EmbeddableNode = {
      ...ALPHA, embeddingVector: [0.1, 0.2], embeddingModel: MODEL, embeddingTextHash: oldHash,
    };
    const stale = getStaleEmbeddableNodes([INBOX, oldFormatNode], edges, MODEL);
    // Old hash does not match new path-aware hash → detected as stale
    expect(stale.map((n) => n.id)).toContain("alpha");
  });

  it("only returns nodes whose hash does not match — fresh nodes excluded", () => {
    const freshAlpha: EmbeddableNode = {
      ...ALPHA, embeddingVector: [0.1, 0.2], embeddingModel: MODEL, embeddingTextHash: freshHash(ALPHA),
    };
    // Beta is stale (no vector)
    const stale = getStaleEmbeddableNodes([INBOX, freshAlpha, BETA], edges, MODEL);
    expect(stale.map((n) => n.id)).not.toContain("alpha");
    expect(stale.map((n) => n.id)).toContain("beta");
  });

  it("path change invalidates hash (breadcrumb differs)", () => {
    // Compute hash as if Alpha were a grandchild "Inbox > Parent > Alpha"
    const wrongBreadcrumb = "Inbox > Parent > Alpha";
    const wrongText = buildNodeEmbeddingText({
      name: ALPHA.name, description: ALPHA.description!, breadcrumb: wrongBreadcrumb,
    });
    const wrongHash = hashEmbeddingInput(wrongText, MODEL);
    const movedNode: EmbeddableNode = {
      ...ALPHA, embeddingVector: [0.1, 0.2], embeddingModel: MODEL, embeddingTextHash: wrongHash,
    };
    // In reality Alpha is a direct child of Inbox → "Inbox > Alpha"
    const stale = getStaleEmbeddableNodes([INBOX, movedNode], edges, MODEL);
    // Wrong breadcrumb hash → detected as stale
    expect(stale.map((n) => n.id)).toContain("alpha");
  });
});
