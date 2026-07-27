import { describe, it, expect } from "vitest";
import {
  parseGrantedScopes,
  hasWritebackScope,
  OUTLOOK_MAIL_READ_SCOPE,
  OUTLOOK_MAIL_READWRITE_SCOPE,
  OUTLOOK_MAILBOX_SETTINGS_RW_SCOPE,
} from "./microsoft-oauth.js";

// The full writeback grant needs BOTH message-write and mailbox-settings-write.
const BOTH = `${OUTLOOK_MAIL_READWRITE_SCOPE} ${OUTLOOK_MAILBOX_SETTINGS_RW_SCOPE}`;

describe("parseGrantedScopes", () => {
  it("detects read-only access (Mail.Read), no writeback", () => {
    const r = parseGrantedScopes(`${OUTLOOK_MAIL_READ_SCOPE} offline_access User.Read`);
    expect(r.hasReadonly).toBe(true);
    expect(r.hasWriteback).toBe(false);
  });

  it("does NOT report writeback for Mail.ReadWrite alone (masterCategories 403s)", () => {
    const r = parseGrantedScopes(`${OUTLOOK_MAIL_READWRITE_SCOPE} offline_access User.Read`);
    expect(r.hasReadonly).toBe(true); // ReadWrite still satisfies reads
    expect(r.hasWriteback).toBe(false);
  });

  it("reports writeback only when BOTH write scopes are present", () => {
    const r = parseGrantedScopes(`${BOTH} offline_access User.Read`);
    expect(r.hasReadonly).toBe(true);
    expect(r.hasWriteback).toBe(true);
  });

  it("matches scopes case-insensitively (Microsoft echoes unstable casing)", () => {
    const r = parseGrantedScopes("mail.readwrite mailboxsettings.readwrite offline_access");
    expect(r.hasWriteback).toBe(true);
    expect(r.hasReadonly).toBe(true);
  });

  it("reports no read access when neither mail scope is present", () => {
    const r = parseGrantedScopes("offline_access User.Read");
    expect(r.hasReadonly).toBe(false);
    expect(r.hasWriteback).toBe(false);
  });
});

describe("hasWritebackScope", () => {
  it("requires both Mail.ReadWrite AND MailboxSettings.ReadWrite (case-insensitive)", () => {
    expect(hasWritebackScope(["Mail.Read"])).toBe(false);
    expect(hasWritebackScope(["Mail.ReadWrite"])).toBe(false); // missing mailbox settings
    expect(hasWritebackScope([OUTLOOK_MAILBOX_SETTINGS_RW_SCOPE])).toBe(false); // missing mail
    expect(hasWritebackScope(["Mail.ReadWrite", "MailboxSettings.ReadWrite"])).toBe(true);
    expect(hasWritebackScope(["mail.readwrite", "mailboxsettings.readwrite"])).toBe(true);
  });
});
