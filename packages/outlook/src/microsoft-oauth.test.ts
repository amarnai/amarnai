import { describe, it, expect } from "vitest";
import {
  parseGrantedScopes,
  hasWritebackScope,
  OUTLOOK_MAIL_READ_SCOPE,
  OUTLOOK_MAIL_READWRITE_SCOPE,
} from "./microsoft-oauth.js";

describe("parseGrantedScopes", () => {
  it("detects read-only access (Mail.Read), no writeback", () => {
    const r = parseGrantedScopes(`${OUTLOOK_MAIL_READ_SCOPE} offline_access User.Read`);
    expect(r.hasReadonly).toBe(true);
    expect(r.hasWriteback).toBe(false);
  });

  it("treats Mail.ReadWrite as satisfying both read and writeback", () => {
    const r = parseGrantedScopes(`${OUTLOOK_MAIL_READWRITE_SCOPE} offline_access User.Read`);
    expect(r.hasReadonly).toBe(true);
    expect(r.hasWriteback).toBe(true);
  });

  it("matches scopes case-insensitively (Microsoft echoes unstable casing)", () => {
    const r = parseGrantedScopes("mail.readwrite offline_access");
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
  it("is true only when Mail.ReadWrite is stored (case-insensitive)", () => {
    expect(hasWritebackScope(["Mail.Read"])).toBe(false);
    expect(hasWritebackScope(["Mail.ReadWrite"])).toBe(true);
    expect(hasWritebackScope(["mail.readwrite"])).toBe(true);
  });
});
