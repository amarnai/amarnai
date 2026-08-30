import { describe, it, expect } from "vitest";
import { applyThreadFilter } from "../jobs/filter-thread-messages.js";
import type { ThreadSnapshot, SnapshotMessage } from "@aziru/ai";
import type { GmailSyncSettings } from "@aziru/shared";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeMessage(id: string, labelIds: string[], receivedAt = new Date("2026-01-01T00:00:00Z")): SnapshotMessage {
  return {
    providerMessageId: id,
    senderEmail: "sender@example.com",
    senderName: null,
    toEmails: [],
    ccEmails: [],
    subject: null,
    bodyExcerpt: null,
    attachments: [],
    receivedAt,
    labelIds,
  };
}

function makeThread(messages: SnapshotMessage[]): ThreadSnapshot {
  const latestMessageAt = messages.reduce<Date>(
    (acc, m) => (m.receivedAt > acc ? m.receivedAt : acc),
    new Date(0)
  );
  return {
    provider: "gmail",
    providerThreadId: "thread-1",
    subject: "Test",
    participants: ["sender@example.com"],
    latestMessageAt,
    messageCount: messages.length,
    messages,
  };
}

const defaultSettings: GmailSyncSettings = {
  includeSpam: false,
  includePromotions: false,
  sortingPaused: false,
  routeBulkToOther: true,
  labelWritebackEnabled: false,
  threadSummaryInjectionEnabled: true,
  replyButtonInjectionEnabled: true,
  injectedPanelEnabled: true,
  blacklistedSenderEmails: [],
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("applyThreadFilter", () => {
  it("default settings are false — normal inbox message passes through", () => {
    const snapshot = makeThread([makeMessage("msg-1", ["INBOX", "UNREAD"])]);
    expect(applyThreadFilter(snapshot, defaultSettings)).not.toBeNull();
  });

  it("TRASH is always excluded regardless of settings", () => {
    const allOn: GmailSyncSettings = { includeSpam: true, includePromotions: true, sortingPaused: false, routeBulkToOther: true, labelWritebackEnabled: false, threadSummaryInjectionEnabled: true, replyButtonInjectionEnabled: true, injectedPanelEnabled: true, blacklistedSenderEmails: [] };
    const snapshot = makeThread([makeMessage("msg-1", ["TRASH"])]);
    expect(applyThreadFilter(snapshot, allOn)).toBeNull();
  });

  it("SPAM is excluded when includeSpam is false", () => {
    const snapshot = makeThread([makeMessage("msg-1", ["SPAM"])]);
    expect(applyThreadFilter(snapshot, defaultSettings)).toBeNull();
  });

  it("SPAM is included when includeSpam is true", () => {
    const settings: GmailSyncSettings = { includeSpam: true, includePromotions: false, sortingPaused: false, routeBulkToOther: true, labelWritebackEnabled: false, threadSummaryInjectionEnabled: true, replyButtonInjectionEnabled: true, injectedPanelEnabled: true, blacklistedSenderEmails: [] };
    const snapshot = makeThread([makeMessage("msg-1", ["SPAM"])]);
    expect(applyThreadFilter(snapshot, settings)).not.toBeNull();
  });

  it("CATEGORY_PROMOTIONS is excluded when includePromotions is false", () => {
    const snapshot = makeThread([makeMessage("msg-1", ["CATEGORY_PROMOTIONS", "INBOX"])]);
    expect(applyThreadFilter(snapshot, defaultSettings)).toBeNull();
  });

  it("CATEGORY_PROMOTIONS is included when includePromotions is true", () => {
    const settings: GmailSyncSettings = { includeSpam: false, includePromotions: true, sortingPaused: false, routeBulkToOther: true, labelWritebackEnabled: false, threadSummaryInjectionEnabled: true, replyButtonInjectionEnabled: true, injectedPanelEnabled: true, blacklistedSenderEmails: [] };
    const snapshot = makeThread([makeMessage("msg-1", ["CATEGORY_PROMOTIONS", "INBOX"])]);
    expect(applyThreadFilter(snapshot, settings)).not.toBeNull();
  });

  it("mixed thread: eligible messages survive, excluded messages are removed", () => {
    const messages = [
      makeMessage("normal-msg", ["INBOX", "UNREAD"]),
      makeMessage("spam-msg",   ["SPAM"]),
      makeMessage("promo-msg",  ["CATEGORY_PROMOTIONS"]),
      makeMessage("trash-msg",  ["TRASH"]),
    ];
    const result = applyThreadFilter(makeThread(messages), defaultSettings);
    expect(result).not.toBeNull();
    expect(result!.messages).toHaveLength(1);
    expect(result!.messages[0]!.providerMessageId).toBe("normal-msg");
  });

  it("all-excluded thread is skipped entirely", () => {
    const messages = [
      makeMessage("spam-msg",  ["SPAM"]),
      makeMessage("trash-msg", ["TRASH"]),
    ];
    expect(applyThreadFilter(makeThread(messages), defaultSettings)).toBeNull();
  });

  it("messageCount and latestMessageAt are recomputed from eligible messages only", () => {
    const earlier = new Date("2026-01-01T00:00:00Z");
    const later   = new Date("2026-01-05T00:00:00Z");
    const messages = [
      makeMessage("normal-1", ["INBOX"],   later),
      makeMessage("spam-msg", ["SPAM"],    later),
      makeMessage("normal-2", ["INBOX"],   earlier),
    ];
    const result = applyThreadFilter(makeThread(messages), defaultSettings);
    expect(result).not.toBeNull();
    expect(result!.messageCount).toBe(2);
    expect(result!.latestMessageAt.getTime()).toBe(later.getTime());
  });

  it("returns original snapshot reference unchanged when no messages are filtered", () => {
    const snapshot = makeThread([
      makeMessage("msg-1", ["INBOX"]),
      makeMessage("msg-2", ["INBOX", "UNREAD"]),
    ]);
    const result = applyThreadFilter(snapshot, defaultSettings);
    expect(result).toBe(snapshot); // same object reference (fast path)
  });

  it("TRASH is excluded even when message also has INBOX label", () => {
    const snapshot = makeThread([makeMessage("msg-1", ["INBOX", "TRASH"])]);
    expect(applyThreadFilter(snapshot, { includeSpam: true, includePromotions: true, sortingPaused: false, routeBulkToOther: true, labelWritebackEnabled: false, threadSummaryInjectionEnabled: true, replyButtonInjectionEnabled: true, injectedPanelEnabled: true, blacklistedSenderEmails: [] })).toBeNull();
  });

  it("SPAM and Promotions are treated independently", () => {
    // Promotions message with includeSpam: true but includePromotions: false → still excluded
    const settings: GmailSyncSettings = { includeSpam: true, includePromotions: false, sortingPaused: false, routeBulkToOther: true, labelWritebackEnabled: false, threadSummaryInjectionEnabled: true, replyButtonInjectionEnabled: true, injectedPanelEnabled: true, blacklistedSenderEmails: [] };
    const promoSnapshot = makeThread([makeMessage("promo", ["CATEGORY_PROMOTIONS"])]);
    expect(applyThreadFilter(promoSnapshot, settings)).toBeNull();

    // Spam message with includePromotions: true but includeSpam: false → still excluded
    const settings2: GmailSyncSettings = { includeSpam: false, includePromotions: true, sortingPaused: false, routeBulkToOther: true, labelWritebackEnabled: false, threadSummaryInjectionEnabled: true, replyButtonInjectionEnabled: true, injectedPanelEnabled: true, blacklistedSenderEmails: [] };
    const spamSnapshot = makeThread([makeMessage("spam", ["SPAM"])]);
    expect(applyThreadFilter(spamSnapshot, settings2)).toBeNull();
  });

  it("blacklisted sender email excludes entire thread", () => {
    const settings: GmailSyncSettings = {
      ...defaultSettings,
      blacklistedSenderEmails: ["blocked@example.com"],
    };
    const snapshot = makeThread([makeMessage("msg-1", ["INBOX"])]);
    // makeMessage uses "sender@example.com" — not blacklisted
    expect(applyThreadFilter(snapshot, settings)).not.toBeNull();

    // Thread with a blacklisted sender
    const blockedMsg: SnapshotMessage = {
      providerMessageId: "blocked-msg",
      senderEmail: "blocked@example.com",
      senderName: null,
      toEmails: [],
      ccEmails: [],
      subject: null,
      bodyExcerpt: null,
      attachments: [],
      receivedAt: new Date("2026-01-01T00:00:00Z"),
      labelIds: ["INBOX"],
    };
    const blockedSnapshot = makeThread([blockedMsg]);
    expect(applyThreadFilter(blockedSnapshot, settings)).toBeNull();
  });

  it("blacklist check is case-insensitive", () => {
    const settings: GmailSyncSettings = {
      ...defaultSettings,
      blacklistedSenderEmails: ["blocked@example.com"],
    };
    const blockedMsg: SnapshotMessage = {
      providerMessageId: "blocked-upper",
      senderEmail: "BLOCKED@EXAMPLE.COM",
      senderName: null,
      toEmails: [],
      ccEmails: [],
      subject: null,
      bodyExcerpt: null,
      attachments: [],
      receivedAt: new Date("2026-01-01T00:00:00Z"),
      labelIds: ["INBOX"],
    };
    expect(applyThreadFilter(makeThread([blockedMsg]), settings)).toBeNull();
  });

  it("message with no labelIds is treated as eligible", () => {
    const msg: SnapshotMessage = {
      providerMessageId: "msg-no-labels",
      senderEmail: "sender@example.com",
      senderName: null,
      toEmails: [],
      ccEmails: [],
      subject: null,
      bodyExcerpt: null,
      attachments: [],
      receivedAt: new Date("2026-01-01T00:00:00Z"),
      // labelIds intentionally omitted
    };
    const snapshot = makeThread([msg]);
    expect(applyThreadFilter(snapshot, defaultSettings)).not.toBeNull();
  });
});
