import { describe, it, expect } from "vitest";
import {
  outlookAccountTypeFromEmail,
  outlookAccountTypeFromWebLink,
  resolveOutlookAccountType,
} from "./outlookAccount.js";

describe("outlookAccountTypeFromEmail", () => {
  it("reads Microsoft consumer domains as personal, including country variants", () => {
    expect(outlookAccountTypeFromEmail("a@outlook.com")).toBe("PERSONAL");
    expect(outlookAccountTypeFromEmail("a@hotmail.co.uk")).toBe("PERSONAL");
    expect(outlookAccountTypeFromEmail("a@live.fr")).toBe("PERSONAL");
    expect(outlookAccountTypeFromEmail("a@msn.com")).toBe("PERSONAL");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(outlookAccountTypeFromEmail("A@Outlook.COM ")).toBe("PERSONAL");
  });

  it("reads anything else as work/school", () => {
    expect(outlookAccountTypeFromEmail("a@contoso.com")).toBe("ORGANIZATION");
  });

  it("returns null when there is no address to read", () => {
    expect(outlookAccountTypeFromEmail(null)).toBeNull();
    expect(outlookAccountTypeFromEmail("not-an-address")).toBeNull();
  });
});

describe("outlookAccountTypeFromWebLink", () => {
  it("reads the mailbox host Microsoft issued the link on", () => {
    expect(outlookAccountTypeFromWebLink("https://outlook.live.com/owa/?ItemID=x")).toBe(
      "PERSONAL"
    );
    expect(outlookAccountTypeFromWebLink("https://outlook.office.com/mail/deeplink/read/x")).toBe(
      "ORGANIZATION"
    );
    // Graph issues webLinks on office365.com, pre-redirect.
    expect(outlookAccountTypeFromWebLink("https://outlook.office365.com/owa/?ItemID=x")).toBe(
      "ORGANIZATION"
    );
  });

  it("returns null rather than guessing on an unknown or unparseable link", () => {
    expect(outlookAccountTypeFromWebLink("https://outlook.example.gov/owa/")).toBeNull();
    expect(outlookAccountTypeFromWebLink("not a url")).toBeNull();
    expect(outlookAccountTypeFromWebLink(null)).toBeNull();
  });
});

describe("resolveOutlookAccountType", () => {
  it("prefers the stored type over the address guess", () => {
    // A personal account registered on a custom domain: the address alone reads
    // as work/school, which is exactly what the stored type is there to correct.
    expect(resolveOutlookAccountType("PERSONAL", "user@custom.dev")).toBe("PERSONAL");
  });

  it("falls back to the address, then to work/school", () => {
    expect(resolveOutlookAccountType(null, "user@outlook.com")).toBe("PERSONAL");
    expect(resolveOutlookAccountType(null, null)).toBe("ORGANIZATION");
  });
});
