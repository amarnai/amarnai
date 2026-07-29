import { describe, it, expect } from "vitest";
import {
  parseGrantedScopes,
  hasWritebackScope,
  accountTypeFromIdToken,
  scopeForCodeRedemption,
  MICROSOFT_CONSUMER_TENANT_ID,
  OUTLOOK_MAIL_READ_SCOPE,
  OUTLOOK_MAIL_READWRITE_SCOPE,
  OUTLOOK_MAILBOX_SETTINGS_RW_SCOPE,
  OUTLOOK_SCOPES,
  OUTLOOK_CONSENT_SCOPES,
} from "./microsoft-oauth.js";

/** An id_token shaped like Microsoft's: three base64url segments, only the
 *  middle one read. The signature is never verified (see accountTypeFromIdToken). */
function idTokenWithClaims(claims: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  return `header.${payload}.signature`;
}

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

describe("accountTypeFromIdToken", () => {
  it("reads the consumer tenant as a personal Microsoft account", () => {
    expect(accountTypeFromIdToken(idTokenWithClaims({ tid: MICROSOFT_CONSUMER_TENANT_ID }))).toBe(
      "PERSONAL",
    );
    // Microsoft is not consistent about GUID casing.
    expect(
      accountTypeFromIdToken(
        idTokenWithClaims({ tid: MICROSOFT_CONSUMER_TENANT_ID.toUpperCase() }),
      ),
    ).toBe("PERSONAL");
  });

  it("reads any other tenant as a work/school account", () => {
    expect(
      accountTypeFromIdToken(idTokenWithClaims({ tid: "72f988bf-86f1-41af-91ab-2d7cd011db47" })),
    ).toBe("ORGANIZATION");
  });

  it("returns null when there is no token, no claim, or no readable payload", () => {
    expect(accountTypeFromIdToken(null)).toBeNull();
    expect(accountTypeFromIdToken(undefined)).toBeNull();
    expect(accountTypeFromIdToken("not-a-jwt")).toBeNull();
    expect(accountTypeFromIdToken("header.not-base64-json.sig")).toBeNull();
    expect(accountTypeFromIdToken(idTokenWithClaims({ oid: "abc" }))).toBeNull();
  });
});

describe("scopeForCodeRedemption", () => {
  it("redeems without openid for a client that did not consent to it", () => {
    // An extension build predating the sign-in scope: asking for more than its
    // authorize request did would have Microsoft reject the redemption.
    expect(scopeForCodeRedemption("Mail.Read offline_access User.Read")).toBe(OUTLOOK_SCOPES);
  });

  it("redeems with openid once the client asks for it", () => {
    expect(scopeForCodeRedemption("openid Mail.Read offline_access User.Read")).toBe(
      OUTLOOK_CONSENT_SCOPES,
    );
  });
});
