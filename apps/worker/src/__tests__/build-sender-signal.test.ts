import { describe, it, expect } from "vitest";
import { buildSenderSignal } from "../jobs/generate-taxonomy.js";

type SampledMessage = { senderEmail: string; senderName: string | null; subject: string | null };

/** Build n messages from one sender/subject, for volume. */
function fromSender(n: number, senderEmail: string, senderName: string, subject: string): SampledMessage[] {
  return Array.from({ length: n }, () => ({ senderEmail, senderName, subject }));
}

describe("buildSenderSignal — no-reply noise suppression", () => {
  it("drops a fully no-reply domain from every folder-defining signal", () => {
    const messages = [
      ...fromSender(20, "no-reply@crunchyroll.com", "Crunchyroll", "Account device sign-in alert"),
      ...fromSender(20, "alice@efrei.fr", "Alice", "Project deadline coursework"),
    ];

    const signal = buildSenderSignal(messages);

    expect(signal.senderDomains.map((d) => d.term)).not.toContain("crunchyroll.com");
    expect(signal.senderClusters.map((c) => c.label)).not.toContain("crunchyroll.com");
    expect(signal.senderNames.map((n) => n.term)).not.toContain("Crunchyroll");
    // The human-correspondence domain survives.
    expect(signal.senderDomains.map((d) => d.term)).toContain("efrei.fr");
  });

  it("keeps a domain that mixes human and no-reply mail", () => {
    // 1 no-reply out of 5 (20%) is well below the 0.8 threshold.
    const messages = [
      ...fromSender(1, "no-reply@acme.com", "Acme Alerts", "System notice"),
      ...fromSender(4, "bob@acme.com", "Bob", "Contract review meeting"),
    ];

    const signal = buildSenderSignal(messages);

    expect(signal.senderDomains.map((d) => d.term)).toContain("acme.com");
  });

  it("respects the 0.8 share boundary", () => {
    // 79% no-reply -> kept; 81% -> dropped. Use 100-message domains for precision.
    const kept = buildSenderSignal([
      ...fromSender(79, "no-reply@kept.com", "Kept", "Update"),
      ...fromSender(21, "human@kept.com", "Human", "Question about invoice"),
    ]);
    expect(kept.senderDomains.map((d) => d.term)).toContain("kept.com");

    const dropped = buildSenderSignal([
      ...fromSender(81, "no-reply@dropped.com", "Dropped", "Update"),
      ...fromSender(19, "human@dropped.com", "Human", "Question about invoice"),
    ]);
    expect(dropped.senderDomains.map((d) => d.term)).not.toContain("dropped.com");
  });
});
