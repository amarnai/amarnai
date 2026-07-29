import { describe, it, expect } from "vitest";
import { buildThreadUrl, buildMailboxUrl } from "./threadUrl.js";

describe("buildThreadUrl", () => {
  it("builds a Gmail hash deep link from the providerThreadId when no account is given", () => {
    expect(
      buildThreadUrl({ provider: "GMAIL", providerThreadId: "abc123", webLink: null })
    ).toBe("https://mail.google.com/mail/u/0/#all/abc123");
  });

  it("routes Gmail by authuser email so the connected account opens, not the browser default", () => {
    expect(
      buildThreadUrl(
        { provider: "GMAIL", providerThreadId: "abc123", webLink: null },
        "user@example.com"
      )
    ).toBe("https://mail.google.com/mail/?authuser=user%40example.com#all/abc123");
  });

  it("URL-encodes the Gmail account email, including plus addressing", () => {
    expect(
      buildThreadUrl(
        { provider: "GMAIL", providerThreadId: "abc123", webLink: null },
        "user+triage@example.com"
      )
    ).toBe("https://mail.google.com/mail/?authuser=user%2Btriage%40example.com#all/abc123");
  });

  it("never routes Gmail by positional /u/<index> when an account email is given", () => {
    const url = buildThreadUrl(
      { provider: "GMAIL", providerThreadId: "abc123", webLink: null },
      "user@example.com"
    );
    expect(url).not.toContain("/u/");
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

  it("appends login_hint to the Outlook webLink when an account email is given", () => {
    expect(
      buildThreadUrl(
        {
          provider: "OUTLOOK",
          providerThreadId: "conv-1",
          webLink: "https://outlook.office.com/mail/deeplink/read/xyz?foo=1",
        },
        "user@contoso.com"
      )
    ).toBe(
      "https://outlook.office.com/mail/deeplink/read/xyz?foo=1&ispopout=0&login_hint=user%40contoso.com"
    );
  });

  it("falls back to the OWA inbox when no Outlook webLink was captured", () => {
    expect(
      buildThreadUrl({ provider: "OUTLOOK", providerThreadId: "conv-1", webLink: null })
    ).toBe("https://outlook.office.com/mail/");
  });

  it("adds login_hint to the OWA inbox fallback when an account email is given", () => {
    expect(
      buildThreadUrl(
        { provider: "OUTLOOK", providerThreadId: "conv-1", webLink: null },
        "user@contoso.com"
      )
    ).toBe("https://outlook.office.com/mail/?login_hint=user%40contoso.com");
  });

  it("falls back to CONSUMER OWA for a personal account with no webLink", () => {
    expect(
      buildThreadUrl(
        { provider: "OUTLOOK", providerThreadId: "conv-1", webLink: null },
        "user@example.com",
        "PERSONAL"
      )
    ).toBe("https://outlook.live.com/mail/0/");
  });

  it("omits login_hint on a personal webLink (consumer OWA ignores it)", () => {
    expect(
      buildThreadUrl(
        {
          provider: "OUTLOOK",
          providerThreadId: "conv-1",
          webLink: "https://outlook.live.com/owa/?ItemID=xyz",
        },
        "user@outlook.com"
      )
    ).toBe("https://outlook.live.com/owa/?ItemID=xyz&ispopout=0");
  });
});

describe("buildMailboxUrl", () => {
  it("routes Gmail by authuser so it cannot open the wrong account", () => {
    expect(buildMailboxUrl("GMAIL", "user@example.com")).toBe(
      "https://mail.google.com/mail/?authuser=user%40example.com#inbox"
    );
  });

  it("falls back to the legacy /u/0/ form with no account email", () => {
    expect(buildMailboxUrl("GMAIL")).toBe("https://mail.google.com/mail/u/0/#inbox");
  });

  it("pre-fills an OWA sign-in with the connected account", () => {
    expect(buildMailboxUrl("OUTLOOK", "user@contoso.com")).toBe(
      "https://outlook.office.com/mail/?login_hint=user%40contoso.com"
    );
  });

  it("opens the plain OWA inbox with no account email", () => {
    expect(buildMailboxUrl("OUTLOOK")).toBe("https://outlook.office.com/mail/");
  });

  it("sends a personal Microsoft account to consumer OWA, never the work host", () => {
    // outlook.office.com refuses personal accounts outright (AADSTS500200).
    expect(buildMailboxUrl("OUTLOOK", "user@example.com", "PERSONAL")).toBe(
      "https://outlook.live.com/mail/0/"
    );
  });

  it("keeps a work/school account on the work host even with a consumer-looking address", () => {
    expect(buildMailboxUrl("OUTLOOK", "user@live.contoso.com", "ORGANIZATION")).toBe(
      "https://outlook.office.com/mail/?login_hint=user%40live.contoso.com"
    );
  });

  it("guesses from the address when the account type is unknown", () => {
    expect(buildMailboxUrl("OUTLOOK", "user@hotmail.fr")).toBe(
      "https://outlook.live.com/mail/0/"
    );
    expect(buildMailboxUrl("OUTLOOK", "user@contoso.com", null)).toBe(
      "https://outlook.office.com/mail/?login_hint=user%40contoso.com"
    );
  });
});
