import { describe, it, expect } from "vitest";
import { createMailProvider } from "./create-mail-provider.js";
import { MailAuthError, MailCursorExpiredError, MailThreadParseError } from "./errors.js";

// The methods every MailProvider must expose (the neutral seam surface).
const MAIL_PROVIDER_METHODS = [
  "refreshAccessToken",
  "getProfile",
  "listChangesSince",
  "listThreadsPage",
  "listThreadIdsByQuery",
  "listRecentThreadIds",
  "getThreadSnapshot",
  "registerWatch",
  "stopWatch",
] as const;

describe("createMailProvider — dispatch", () => {
  it("returns a Gmail adapter conforming to the MailProvider surface for GMAIL", () => {
    const client = createMailProvider({
      provider: "GMAIL",
      encryptedRefreshToken: "enc",
    });
    for (const method of MAIL_PROVIDER_METHODS) {
      expect(typeof (client as unknown as Record<string, unknown>)[method]).toBe("function");
    }
  });

  it("returns an Outlook (Graph) adapter conforming to the MailProvider surface for OUTLOOK", () => {
    const client = createMailProvider({
      provider: "OUTLOOK",
      encryptedRefreshToken: "enc",
    });
    for (const method of MAIL_PROVIDER_METHODS) {
      expect(typeof (client as unknown as Record<string, unknown>)[method]).toBe("function");
    }
  });

  it("dispatches to distinct adapter implementations per provider", () => {
    const gmail = createMailProvider({ provider: "GMAIL", encryptedRefreshToken: "enc" });
    const outlook = createMailProvider({ provider: "OUTLOOK", encryptedRefreshToken: "enc" });
    expect(gmail.constructor.name).toBe("GmailClient");
    expect(outlook.constructor.name).toBe("GraphClient");
  });
});

describe("neutral error mapping", () => {
  it("exposes MailAuthError / MailCursorExpiredError / MailThreadParseError as Error subclasses", () => {
    expect(new MailAuthError("x")).toBeInstanceOf(Error);
    expect(new MailCursorExpiredError("x")).toBeInstanceOf(Error);
    expect(new MailThreadParseError(new Error("x"))).toBeInstanceOf(Error);
  });

  it("maps distinct error identities (a cursor-expiry is not an auth failure)", () => {
    const cursor = new MailCursorExpiredError("expired");
    expect(cursor).toBeInstanceOf(MailCursorExpiredError);
    expect(cursor).not.toBeInstanceOf(MailAuthError);
  });
});
