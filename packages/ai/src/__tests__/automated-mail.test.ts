import { describe, it, expect } from "vitest";
import {
  detectAutomatedThread,
  detectAutomatedThreadFromMeta,
  isAutomatedMessage,
} from "../detection/automated-mail.js";
import type { SnapshotMessage } from "../thread-snapshot.js";

function msg(overrides: Partial<SnapshotMessage> = {}): SnapshotMessage {
  return {
    providerMessageId: "m1",
    senderEmail: "alice@example.com",
    senderName: "Alice",
    toEmails: [],
    ccEmails: [],
    subject: "Hi",
    bodyExcerpt: null,
    attachments: [],
    receivedAt: new Date("2026-01-01T00:00:00Z"),
    labelIds: ["INBOX"],
    automatedHeaders: { listUnsubscribe: false, listId: false, autoSubmitted: null, precedence: null },
    ...overrides,
  };
}

describe("detectAutomatedThread", () => {
  it("flags a Google no-reply notification (sender signal, no List-* headers)", () => {
    const m = msg({ senderEmail: "google-maps-noreply@google.com", labelIds: ["INBOX"] });
    expect(isAutomatedMessage(m)).toBe(true);
    expect(detectAutomatedThread([m])).toBe(true);
  });

  it("flags a non-Google newsletter via List-Unsubscribe header", () => {
    const m = msg({
      senderEmail: "news@substack.com",
      automatedHeaders: { listUnsubscribe: true, listId: false, autoSubmitted: null, precedence: null },
    });
    expect(detectAutomatedThread([m])).toBe(true);
  });

  it("flags bulk via Precedence and Auto-Submitted headers", () => {
    expect(
      detectAutomatedThread([
        msg({ automatedHeaders: { listUnsubscribe: false, listId: false, autoSubmitted: null, precedence: "bulk" } }),
      ])
    ).toBe(true);
    expect(
      detectAutomatedThread([
        msg({ automatedHeaders: { listUnsubscribe: false, listId: false, autoSubmitted: "auto-generated", precedence: null } }),
      ])
    ).toBe(true);
  });

  it("flags Gmail bulk categories", () => {
    expect(detectAutomatedThread([msg({ labelIds: ["CATEGORY_UPDATES"] })])).toBe(true);
    expect(detectAutomatedThread([msg({ labelIds: ["CATEGORY_SOCIAL"] })])).toBe(true);
  });

  it("does NOT flag a genuine personal email", () => {
    expect(detectAutomatedThread([msg({ senderEmail: "bob@gmail.com", labelIds: ["INBOX", "UNREAD"] })])).toBe(false);
  });

  it("does NOT flag a thread with any human-authored message (every guard)", () => {
    const automated = msg({ senderEmail: "no-reply@service.com" });
    const human = msg({ senderEmail: "carol@gmail.com" });
    expect(detectAutomatedThread([automated, human])).toBe(false);
  });

  it("vetoes on IMPORTANT even with a no-reply sender", () => {
    expect(
      detectAutomatedThread([msg({ senderEmail: "no-reply@service.com", labelIds: ["INBOX", "IMPORTANT"] })])
    ).toBe(false);
  });

  it("vetoes on CATEGORY_PERSONAL", () => {
    expect(
      detectAutomatedThread([msg({ labelIds: ["CATEGORY_UPDATES", "CATEGORY_PERSONAL"] })])
    ).toBe(false);
  });

  it("is not automated for an empty thread", () => {
    expect(detectAutomatedThread([])).toBe(false);
  });

  it("does not false-positive on a 'reply@' style address", () => {
    expect(isAutomatedMessage(msg({ senderEmail: "reply@person.com" }))).toBe(false);
  });
});

describe("detectAutomatedThreadFromMeta", () => {
  it("flags via bulk category labels only", () => {
    expect(detectAutomatedThreadFromMeta([["CATEGORY_UPDATES"]])).toBe(true);
    expect(detectAutomatedThreadFromMeta([["CATEGORY_PROMOTIONS"], ["CATEGORY_FORUMS"]])).toBe(true);
  });

  it("does NOT flag plain inbox mail (no header/sender signals available)", () => {
    expect(detectAutomatedThreadFromMeta([["INBOX", "UNREAD"]])).toBe(false);
  });

  it("respects the IMPORTANT veto and the every guard", () => {
    expect(detectAutomatedThreadFromMeta([["CATEGORY_UPDATES", "IMPORTANT"]])).toBe(false);
    expect(detectAutomatedThreadFromMeta([["CATEGORY_UPDATES"], ["INBOX"]])).toBe(false);
  });

  it("is not automated for an empty list", () => {
    expect(detectAutomatedThreadFromMeta([])).toBe(false);
  });
});
