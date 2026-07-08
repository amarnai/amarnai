import { describe, it, expect } from "vitest";
import { buildThreadUrl } from "./threadUrl.js";

describe("buildThreadUrl", () => {
  it("builds a Gmail hash deep link from the providerThreadId", () => {
    expect(
      buildThreadUrl({ provider: "GMAIL", providerThreadId: "abc123", webLink: null })
    ).toBe("https://mail.google.com/mail/u/0/#all/abc123");
  });

  it("uses the stored webLink for Outlook and forces the reading pane", () => {
    expect(
      buildThreadUrl({
        provider: "OUTLOOK",
        providerThreadId: "conv-1",
        webLink: "https://outlook.office.com/mail/deeplink/read/xyz",
      })
    ).toBe("https://outlook.office.com/mail/deeplink/read/xyz?ispopout=0");
  });

  it("appends ispopout with & when the webLink already has a query string", () => {
    expect(
      buildThreadUrl({
        provider: "OUTLOOK",
        providerThreadId: "conv-1",
        webLink: "https://outlook.office.com/mail/deeplink/read/xyz?foo=1",
      })
    ).toBe("https://outlook.office.com/mail/deeplink/read/xyz?foo=1&ispopout=0");
  });

  it("falls back to the OWA inbox when no Outlook webLink was captured", () => {
    expect(
      buildThreadUrl({ provider: "OUTLOOK", providerThreadId: "conv-1", webLink: null })
    ).toBe("https://outlook.office.com/mail/");
  });
});
