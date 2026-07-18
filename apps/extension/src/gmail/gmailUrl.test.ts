import { describe, it, expect } from "vitest";
import { buildGmailThreadHashUrl } from "./gmailUrl";

// The full account-routed (`authuser`) URL shape is pinned by core's
// threadUrl.test.ts — the extension shares that implementation.
describe("buildGmailThreadHashUrl", () => {
  it("replaces an existing hash while preserving the account path", () => {
    const url = buildGmailThreadHashUrl(
      "https://mail.google.com/mail/u/0/#inbox",
      "18c2f4a9b3d5e6f7",
    );
    expect(url).toBe("https://mail.google.com/mail/u/0/#all/18c2f4a9b3d5e6f7");
  });

  it("preserves the path and query, changing only the fragment", () => {
    const url = buildGmailThreadHashUrl(
      "https://mail.google.com/mail/u/1/?tab=rm#all/OLD",
      "deadbeef",
    );
    expect(url).toBe("https://mail.google.com/mail/u/1/?tab=rm#all/deadbeef");
  });

  it("appends a hash when the existing url has none", () => {
    const url = buildGmailThreadHashUrl(
      "https://mail.google.com/mail/u/0/",
      "abc123",
    );
    expect(url).toBe("https://mail.google.com/mail/u/0/#all/abc123");
  });
});
