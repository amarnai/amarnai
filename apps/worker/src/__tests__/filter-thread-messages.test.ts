import { describe, it, expect } from "vitest";
import type { SnapshotMessage } from "@amarnai/ai";
import {
  computeThreadLabelFlags,
  computeThreadLabelFlagsFromMeta,
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
