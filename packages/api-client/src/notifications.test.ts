import { describe, it, expect } from "vitest";
import { interpretNotification } from "./notifications.js";
import type { NotificationItem } from "./types.js";

function item(type: string, params: Record<string, unknown>): NotificationItem {
  return {
    id: "n1",
    workspaceId: "ws1",
    type,
    params,
    readAt: null,
    dismissedAt: null,
    createdAt: "2026-07-01T00:00:00.000Z",
  };
}

describe("interpretNotification", () => {
  it("maps gmail_disconnected with its address", () => {
    expect(interpretNotification(item("gmail_disconnected", { gmailAddress: "a@b.com" }))).toEqual({
      kind: "gmail_disconnected",
      gmailAddress: "a@b.com",
    });
  });

  it("maps backfill_complete, coercing counts and defaulting capReached", () => {
    expect(
      interpretNotification(item("backfill_complete", { processed: 12, skipped: 2, capReached: true })),
    ).toEqual({ kind: "backfill_complete", processed: 12, skipped: 2, capReached: true });
  });

  it("nulls out non-numeric backfill counts and treats a missing capReached as false", () => {
    expect(
      interpretNotification(item("backfill_complete", { processed: "lots", skipped: null })),
    ).toEqual({ kind: "backfill_complete", processed: null, skipped: null, capReached: false });
  });

  it("maps quota_blocked with a whitelisted plan", () => {
    expect(interpretNotification(item("quota_blocked", { plan: "BUSINESS" }))).toEqual({
      kind: "quota_blocked",
      plan: "BUSINESS",
    });
  });

  it("nulls out an unrecognized plan (stays clickable to upgrade)", () => {
    expect(interpretNotification(item("quota_blocked", { plan: "ENTERPRISE" }))).toEqual({
      kind: "quota_blocked",
      plan: null,
    });
  });

  it("maps comment_mention, preferring the mentioner's name over their email", () => {
    expect(
      interpretNotification(
        item("comment_mention", {
          mentionedByName: "Alice",
          mentionedByEmail: "alice@example.com",
          subject: "Invoice",
          threadId: "t1",
          commentId: "c1",
        }),
      ),
    ).toEqual({
      kind: "comment_mention",
      mentionedBy: "Alice",
      subject: "Invoice",
      threadId: "t1",
    });
  });

  it("falls back to the mentioner's email and nulls missing comment_mention params", () => {
    expect(
      interpretNotification(item("comment_mention", { mentionedByEmail: "alice@example.com" })),
    ).toEqual({
      kind: "comment_mention",
      mentionedBy: "alice@example.com",
      subject: null,
      threadId: null,
    });
    expect(interpretNotification(item("comment_mention", {}))).toEqual({
      kind: "comment_mention",
      mentionedBy: null,
      subject: null,
      threadId: null,
    });
  });

  it("falls back to unknown for an unrecognized type", () => {
    expect(interpretNotification(item("something_new", {}))).toEqual({ kind: "unknown" });
  });
});
