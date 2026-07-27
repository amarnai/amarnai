import { describe, expect, it } from "vitest";
import {
  GmailSyncSettingsSchema,
  UpdateGmailSyncSettingsSchema,
  DEFAULT_GMAIL_SYNC_SETTINGS,
} from "./gmail-sync-settings.js";

// The two native-injection toggles are independent on purpose: a workspace can
// keep thread summaries in Gmail/Outlook while turning the reply button off (or
// the reverse). These tests pin that independence and the on-by-default stance,
// since both are the kind of thing a later refactor could quietly collapse.

describe("GmailSyncSettingsSchema", () => {
  it("defaults both native-injection toggles to on", () => {
    const parsed = GmailSyncSettingsSchema.parse({});
    expect(parsed.threadSummaryInjectionEnabled).toBe(true);
    expect(parsed.replyButtonInjectionEnabled).toBe(true);
  });

  it("lets either injection toggle be turned off without touching the other", () => {
    expect(
      GmailSyncSettingsSchema.parse({ replyButtonInjectionEnabled: false })
    ).toMatchObject({
      replyButtonInjectionEnabled: false,
      threadSummaryInjectionEnabled: true,
    });

    expect(
      GmailSyncSettingsSchema.parse({ threadSummaryInjectionEnabled: false })
    ).toMatchObject({
      threadSummaryInjectionEnabled: false,
      replyButtonInjectionEnabled: true,
    });
  });

  it("rejects a non-boolean reply-button toggle", () => {
    expect(() =>
      GmailSyncSettingsSchema.parse({ replyButtonInjectionEnabled: "yes" })
    ).toThrow();
  });
});

describe("DEFAULT_GMAIL_SYNC_SETTINGS", () => {
  it("matches what the schema produces for an empty object", () => {
    expect(GmailSyncSettingsSchema.parse({})).toEqual(DEFAULT_GMAIL_SYNC_SETTINGS);
  });
});

describe("UpdateGmailSyncSettingsSchema", () => {
  it("accepts the reply-button toggle on its own", () => {
    expect(
      UpdateGmailSyncSettingsSchema.parse({ replyButtonInjectionEnabled: false })
    ).toEqual({ replyButtonInjectionEnabled: false });
  });

  it("leaves omitted fields undefined so a PATCH never clobbers them", () => {
    const parsed = UpdateGmailSyncSettingsSchema.parse({
      replyButtonInjectionEnabled: true,
    });
    expect(parsed.threadSummaryInjectionEnabled).toBeUndefined();
    expect(parsed.labelWritebackEnabled).toBeUndefined();
  });
});
