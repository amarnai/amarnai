import { describe, it, expect } from "vitest";
import {
  detectAutomatedThread,
  isAutomatedMessage,
  senderIsNoReply,
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

  it("IMPORTANT does NOT veto a strong signal (no-reply sender or bulk headers)", () => {
    // Gmail's IMPORTANT auto-heuristic routinely flags bulk (e.g. Google's own
    // no-reply notifications); a machine-origin signal must override it.
    expect(
      detectAutomatedThread([msg({ senderEmail: "google-maps-noreply@google.com", labelIds: ["INBOX", "IMPORTANT"] })])
    ).toBe(true);
    expect(
      detectAutomatedThread([
        msg({
          senderEmail: "news@substack.com",
          labelIds: ["INBOX", "IMPORTANT"],
          automatedHeaders: { listUnsubscribe: true, listId: false, autoSubmitted: null, precedence: null },
        }),
      ])
    ).toBe(true);
  });

  it("IMPORTANT vetoes a weak (category-only) detection", () => {
    // Only a Gmail bulk category, no strong signal — IMPORTANT wins.
    expect(
      detectAutomatedThread([msg({ senderEmail: "person@gmail.com", labelIds: ["CATEGORY_UPDATES", "IMPORTANT"] })])
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

  it("ignores the owner's own reply to a no-reply notification (selfEmail)", () => {
    const notification = msg({ providerMessageId: "m1", senderEmail: "no-reply@service.com" });
    const ownReply = msg({ providerMessageId: "m2", senderEmail: "owner@gmail.com" });
    // Without selfEmail the human reply defeats the every-message guard.
    expect(detectAutomatedThread([notification, ownReply])).toBe(false);
    // With selfEmail the owner's reply is excluded, so the thread is automated.
    expect(detectAutomatedThread([notification, ownReply], "owner@gmail.com")).toBe(true);
  });

  it("matches selfEmail case-insensitively", () => {
    const notification = msg({ providerMessageId: "m1", senderEmail: "no-reply@service.com" });
    const ownReply = msg({ providerMessageId: "m2", senderEmail: "Owner@Gmail.com" });
    expect(detectAutomatedThread([notification, ownReply], "owner@gmail.com")).toBe(true);
  });

  it("is not automated when only the owner's own messages remain", () => {
    const ownOnly = msg({ senderEmail: "owner@gmail.com" });
    expect(detectAutomatedThread([ownOnly], "owner@gmail.com")).toBe(false);
  });

  it("does NOT flag a genuine two-person thread even with selfEmail", () => {
    const alice = msg({ providerMessageId: "m1", senderEmail: "alice@gmail.com" });
    const ownReply = msg({ providerMessageId: "m2", senderEmail: "owner@gmail.com" });
    // Excluding the owner must not turn a real correspondent into automated mail.
    expect(detectAutomatedThread([alice, ownReply], "owner@gmail.com")).toBe(false);
  });
});

describe("senderIsNoReply", () => {
  it("matches no-reply and notification local parts across domains", () => {
    expect(senderIsNoReply("no-reply@accounts.google.com")).toBe(true);
    expect(senderIsNoReply("noreply@crunchyroll.com")).toBe(true);
    expect(senderIsNoReply("notifications@service.com")).toBe(true);
    expect(senderIsNoReply("google-maps-noreply@google.com")).toBe(true);
  });

  it("does not match a human or a 'reply@' style address", () => {
    expect(senderIsNoReply("bob@gmail.com")).toBe(false);
    expect(senderIsNoReply("reply@person.com")).toBe(false);
  });
});

