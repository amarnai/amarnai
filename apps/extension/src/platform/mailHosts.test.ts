import { describe, it, expect } from "vitest";
import {
  GMAIL_MAIL_HOST,
  GMAIL_MAIL_ORIGIN,
  MAIL_HOSTS,
  OUTLOOK_MAIL_HOSTS,
  OUTLOOK_MAIL_ORIGINS,
} from "./mailHosts";

// The origins and the match patterns describe the same four hosts, and the
// injected panel's allowlist is built from the origins while the manifest's
// web_accessible_resources are built from the patterns. If the two ever name
// different hosts, a page could load the panel iframe and then be refused by the
// frame — or, worse in the other direction, be trusted without being exposed.

describe("mail hosts", () => {
  it("gives every match pattern a corresponding origin", () => {
    const origins = [GMAIL_MAIL_ORIGIN, ...OUTLOOK_MAIL_ORIGINS];
    expect(origins).toEqual(MAIL_HOSTS.map((h) => h.replace(/\/\*$/, "")));
  });

  it("strips the path glob and nothing else", () => {
    expect(GMAIL_MAIL_ORIGIN).toBe("https://mail.google.com");
    expect(OUTLOOK_MAIL_ORIGINS).toEqual([
      "https://outlook.office.com",
      "https://outlook.office365.com",
      "https://outlook.live.com",
    ]);
  });

  it("yields origins a URL can be compared against directly", () => {
    // What `event.origin` looks like: scheme + host, no trailing slash, no path.
    for (const origin of [GMAIL_MAIL_ORIGIN, ...OUTLOOK_MAIL_ORIGINS]) {
      expect(new URL(origin).origin).toBe(origin);
    }
  });

  it("keeps Gmail out of the Outlook list, and the reverse", () => {
    expect(OUTLOOK_MAIL_ORIGINS).not.toContain(GMAIL_MAIL_ORIGIN);
    expect(OUTLOOK_MAIL_HOSTS).not.toContain(GMAIL_MAIL_HOST);
  });
});
