import { describe, it, expect } from "vitest";
import { buildThreadUrl } from "./threadUrl.js";

describe("buildThreadUrl", () => {
  it("builds a Gmail hash deep link from the providerThreadId", () => {
    expect(
      buildThreadUrl({ provider: "GMAIL", providerThreadId: "abc123", webLink: null })
    ).toBe("https://mail.google.com/mail/u/0/#all/abc123");
  });

  it("rebuilds the full-mailbox OWA URL from a work/school webLink's ItemID", () => {
    // Real Graph webLinks point at the standalone reading popout; we lift the
    // (still-encoded) ItemID into the /mail/inbox/id/ path so the folder list and
    // back navigation stay, and drop the office365 host for the office.com app.
    expect(
      buildThreadUrl({
        provider: "OUTLOOK",
        providerThreadId: "conv-1",
        webLink:
          "https://outlook.office365.com/owa/?ItemID=AAMkAGI2%2Fabc%3D&exvsurl=1&viewmodel=ReadMessageItem",
      })
    ).toBe("https://outlook.office.com/mail/inbox/id/AAMkAGI2%2Fabc%3D");
  });

  it("keeps the personal outlook.live.com host for consumer accounts", () => {
    expect(
      buildThreadUrl({
        provider: "OUTLOOK",
        providerThreadId: "conv-1",
        webLink: "https://outlook.live.com/owa/?ItemID=XYZ%3D&exvsurl=1&viewmodel=ReadMessageItem",
      })
    ).toBe("https://outlook.live.com/mail/inbox/id/XYZ%3D");
  });

  it("falls back to the OWA inbox when no Outlook webLink was captured", () => {
    expect(
      buildThreadUrl({ provider: "OUTLOOK", providerThreadId: "conv-1", webLink: null })
    ).toBe("https://outlook.office.com/mail/");
  });

  it("falls back to the mailbox root when the webLink carries no ItemID", () => {
    expect(
      buildThreadUrl({
        provider: "OUTLOOK",
        providerThreadId: "conv-1",
        webLink: "https://outlook.live.com/mail/",
      })
    ).toBe("https://outlook.live.com/mail/");
  });
});
