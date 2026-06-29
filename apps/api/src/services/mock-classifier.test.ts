import { describe, it, expect } from "vitest";
import { mockClassify } from "./mock-classifier.js";

const messages = [
  { subject: "Invoice due", senderEmail: "billing@acme.com", senderName: "Acme", bodyText: "Please pay." },
];

describe("mockClassify", () => {
  it("never routes to the catch-all, even when its name matches the text", () => {
    const nodes = [
      { id: "root", name: "Inbox", isRoot: true, isCatchAll: false },
      { id: "finance", name: "Invoice", isRoot: false, isCatchAll: false },
      { id: "other", name: "Invoice", isRoot: false, isCatchAll: true },
    ];
    const result = mockClassify(messages, nodes);
    // Both non-root nodes match "invoice", but the catch-all must be excluded.
    expect(result.finalNodeId).toBe("finance");
  });

  it("throws when there is no routable (non-root, non-catch-all) folder", () => {
    const nodes = [
      { id: "root", name: "Inbox", isRoot: true, isCatchAll: false },
      { id: "other", name: "Updates / Other", isRoot: false, isCatchAll: true },
    ];
    expect(() => mockClassify(messages, nodes)).toThrow(/no routable/i);
  });
});
