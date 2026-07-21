import { describe, it, expect } from "vitest";
import type { SnapshotMessage } from "@amarnai/ai";
import {
  computeThreadLabelFlags,
  computeThreadLabelFlagsFromMeta,
  isOutboundLabelSet,
  isSentOnlyThreadMeta,
  isSentOnlyThreadMetaByIdentity,
  isSentOnlyThreadSnapshot,
} from "../jobs/filter-thread-messages.js";

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

describe("computeThreadLabelFlagsFromMeta", () => {
  it("never produces isAutomated, so a meta refresh cannot clobber a full-fetch verdict", () => {
    const flags = computeThreadLabelFlagsFromMeta([["INBOX"]]);
    // The metadata path is blind to senders/headers; it must not carry an
    // isAutomated key, or spreading it into an EmailThread.update would reset a
    // correct (full-fetch) isAutomated=true back to false.
    expect(Object.prototype.hasOwnProperty.call(flags, "isAutomated")).toBe(false);
    expect("isAutomated" in flags).toBe(false);
  });

  it("still derives the label-only flags it can see", () => {
    expect(computeThreadLabelFlagsFromMeta([["CATEGORY_PROMOTIONS"]]).gmailIsPromotions).toBe(true);
    expect(computeThreadLabelFlagsFromMeta([["TRASH"]]).gmailIsTrash).toBe(true);
  });
});

describe("computeThreadLabelFlags", () => {
  it("flags a no-reply thread as automated (full-fetch verdict)", () => {
    expect(computeThreadLabelFlags([msg({ senderEmail: "no-reply@service.com" })]).isAutomated).toBe(true);
  });

  it("forwards selfEmail so the owner's reply does not defeat detection", () => {
    const notification = msg({ providerMessageId: "m1", senderEmail: "no-reply@service.com" });
    const ownReply = msg({ providerMessageId: "m2", senderEmail: "owner@gmail.com" });
    expect(computeThreadLabelFlags([notification, ownReply]).isAutomated).toBe(false);
    expect(computeThreadLabelFlags([notification, ownReply], "owner@gmail.com").isAutomated).toBe(true);
  });

  it("flags a no-reply thread Gmail filed under Primary (CATEGORY_PERSONAL) as automated", () => {
    // End-to-end guard for the sync/backfill path: a no-reply sender Gmail placed
    // in Primary and flagged IMPORTANT must still yield isAutomated=true so the
    // thread auto-files to catch-all.
    expect(
      computeThreadLabelFlags([
        msg({ senderEmail: "no-reply@service.com", labelIds: ["INBOX", "CATEGORY_PERSONAL", "IMPORTANT"] }),
      ]).isAutomated
    ).toBe(true);
  });
});

describe("isOutboundLabelSet", () => {
  it("is true only for SENT without INBOX", () => {
    expect(isOutboundLabelSet(["SENT"])).toBe(true);
    expect(isOutboundLabelSet(["SENT", "UNREAD"])).toBe(true);
  });

  it("is false for note-to-self (SENT + INBOX), inbox mail, and drafts", () => {
    expect(isOutboundLabelSet(["SENT", "INBOX"])).toBe(false);
    expect(isOutboundLabelSet(["INBOX"])).toBe(false);
    expect(isOutboundLabelSet(["DRAFT"])).toBe(false);
  });

  it("fails open on unknown label data (undefined / empty)", () => {
    expect(isOutboundLabelSet(undefined)).toBe(false);
    expect(isOutboundLabelSet([])).toBe(false);
  });
});

describe("isSentOnlyThreadMeta", () => {
  it("is true when every message is outbound", () => {
    expect(isSentOnlyThreadMeta([["SENT"]])).toBe(true);
    expect(isSentOnlyThreadMeta([["SENT"], ["SENT", "UNREAD"]])).toBe(true);
  });

  it("is false for note-to-self, mixed threads, and drafts", () => {
    expect(isSentOnlyThreadMeta([["SENT", "INBOX"]])).toBe(false);
    expect(isSentOnlyThreadMeta([["SENT"], ["INBOX"]])).toBe(false);
    expect(isSentOnlyThreadMeta([["SENT"], ["DRAFT"]])).toBe(false);
  });

  it("is false for the fetch-failed placeholder (no messages) and empty label sets", () => {
    expect(isSentOnlyThreadMeta([])).toBe(false);
    expect(isSentOnlyThreadMeta([[]])).toBe(false);
  });
});

describe("isSentOnlyThreadMetaByIdentity", () => {
  const OWNER = "owner@gmail.com";

  it("is true when the owner is the sole sender and not a recipient", () => {
    expect(isSentOnlyThreadMetaByIdentity([OWNER], [["ext@corp.com"]], OWNER)).toBe(true);
    expect(
      isSentOnlyThreadMetaByIdentity(["OWNER@Gmail.com", OWNER], [["a@b.com"], ["a@b.com"]], OWNER)
    ).toBe(true);
  });

  it("does not depend on labels: works for an INBOX-carrying send (the prod case)", () => {
    // Same owner/external shape the prod send had; identity flags it with no labels involved.
    expect(isSentOnlyThreadMetaByIdentity([OWNER], [["ext@corp.com"]], OWNER)).toBe(true);
  });

  it("is false for a note-to-self, a reply from someone else, and empty metadata", () => {
    expect(isSentOnlyThreadMetaByIdentity([OWNER], [[OWNER]], OWNER)).toBe(false);
    expect(isSentOnlyThreadMetaByIdentity([OWNER, "x@y.com"], [["x@y.com"], []], OWNER)).toBe(false);
    expect(isSentOnlyThreadMetaByIdentity([], [], OWNER)).toBe(false);
  });
});

describe("isSentOnlyThreadSnapshot", () => {
  const OWNER = "owner@gmail.com";

  it("is true when the owner is the sole sender and not a recipient", () => {
    expect(
      isSentOnlyThreadSnapshot(
        [msg({ senderEmail: OWNER, toEmails: ["someone@else.com"] })],
        OWNER
      )
    ).toBe(true);
    // Multiple owner-sent messages, no reply, still sent-only. Case-insensitive.
    expect(
      isSentOnlyThreadSnapshot(
        [
          msg({ senderEmail: "OWNER@Gmail.com", toEmails: ["a@b.com"] }),
          msg({ senderEmail: OWNER, toEmails: ["a@b.com"] }),
        ],
        OWNER
      )
    ).toBe(true);
  });

  it("does not depend on Gmail labels: an owner send carrying INBOX is still sent-only", () => {
    // The exact prod failure: a plain external send that still carries INBOX.
    expect(
      isSentOnlyThreadSnapshot(
        [msg({ senderEmail: OWNER, toEmails: ["ext@corp.com"], labelIds: ["SENT", "INBOX"] })],
        OWNER
      )
    ).toBe(true);
  });

  it("falls back to the SENT label for a 'send mail as' alias (From is not the owner)", () => {
    // Sent from an alias, so identity (From == owner) misses it, but the SENT
    // label — present without INBOX — catches it.
    expect(
      isSentOnlyThreadSnapshot(
        [msg({ senderEmail: "alias@other.com", toEmails: ["ext@corp.com"], labelIds: ["SENT"] })],
        OWNER
      )
    ).toBe(true);
  });

  it("is false for a reply from someone else, a note-to-self, and an empty thread", () => {
    // A message from another sender → not sent-only.
    expect(
      isSentOnlyThreadSnapshot(
        [msg({ senderEmail: OWNER, toEmails: ["x@y.com"] }), msg({ senderEmail: "x@y.com" })],
        OWNER
      )
    ).toBe(false);
    // Note-to-self: owner is also a recipient → kept.
    expect(
      isSentOnlyThreadSnapshot([msg({ senderEmail: OWNER, toEmails: [OWNER] })], OWNER)
    ).toBe(false);
    expect(
      isSentOnlyThreadSnapshot([msg({ senderEmail: OWNER, ccEmails: [OWNER], toEmails: ["x@y.com"] })], OWNER)
    ).toBe(false);
    expect(isSentOnlyThreadSnapshot([], OWNER)).toBe(false);
  });
});
