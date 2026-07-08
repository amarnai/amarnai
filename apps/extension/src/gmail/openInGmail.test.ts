import { describe, it, expect, beforeEach, vi } from "vitest";
import { openInGmail, openInOutlook, __resetPinnedGmailTab } from "./openInGmail";
import { ext } from "../platform/ext";

const EMAIL = "user@example.com";
const THREAD = "18c2f4a9b3d5e6f7";
const AUTHUSER_URL =
  "https://mail.google.com/mail/?authuser=user%40example.com#all/18c2f4a9b3d5e6f7";

function tab(t: Partial<chrome.tabs.Tab>): chrome.tabs.Tab {
  return t as chrome.tabs.Tab;
}

describe("openInGmail", () => {
  beforeEach(() => {
    __resetPinnedGmailTab();
    vi.mocked(ext.tabs.query).mockReset();
    vi.mocked(ext.tabs.update).mockReset();
    // mockClear (not mockReset) keeps the stub's Tab-returning implementation so
    // the production `created.id` read is safe; @types/chrome's callback overload
    // makes mockResolvedValue infer `void`, so we rely on the stub instead.
    vi.mocked(ext.tabs.create).mockClear();
  });

  it("opens a new tab on the correct account when no Gmail tab exists", async () => {
    vi.mocked(ext.tabs.query).mockResolvedValue([]);

    await openInGmail(EMAIL, THREAD);

    expect(ext.tabs.create).toHaveBeenCalledWith({ url: AUTHUSER_URL });
    expect(ext.tabs.update).not.toHaveBeenCalled();
  });

  it("navigates the active Gmail tab by authuser on the first (unpinned) open", async () => {
    vi.mocked(ext.tabs.query).mockResolvedValue([
      tab({ id: 1, active: false, url: "https://mail.google.com/mail/u/0/#inbox" }),
      tab({ id: 2, active: true, url: "https://mail.google.com/mail/u/0/#inbox" }),
    ]);

    await openInGmail(EMAIL, THREAD);

    expect(ext.tabs.update).toHaveBeenCalledWith(2, { url: AUTHUSER_URL, active: true });
    expect(ext.tabs.create).not.toHaveBeenCalled();
  });

  it("navigates the first Gmail tab by authuser when none is active and none pinned", async () => {
    vi.mocked(ext.tabs.query).mockResolvedValue([
      tab({ id: 5, active: false, url: "https://mail.google.com/mail/u/0/#inbox" }),
      tab({ id: 6, active: false, url: "https://mail.google.com/mail/u/0/#inbox" }),
    ]);

    await openInGmail(EMAIL, THREAD);

    expect(ext.tabs.update).toHaveBeenCalledWith(5, { url: AUTHUSER_URL, active: true });
    expect(ext.tabs.create).not.toHaveBeenCalled();
  });

  it("switches threads via a hash-only change once the tab is pinned", async () => {
    // First open pins tab 2 via the full authuser navigation.
    vi.mocked(ext.tabs.query).mockResolvedValue([
      tab({ id: 2, active: true, url: "https://mail.google.com/mail/u/0/#inbox" }),
    ]);
    await openInGmail(EMAIL, THREAD);
    expect(ext.tabs.update).toHaveBeenLastCalledWith(2, { url: AUTHUSER_URL, active: true });

    // Second open of the same (now pinned) tab changes only the hash — no reload,
    // and it inherits the tab's account path (/u/0/) rather than re-adding authuser.
    vi.mocked(ext.tabs.query).mockResolvedValue([
      tab({ id: 2, active: true, url: "https://mail.google.com/mail/u/0/#all/OLD" }),
    ]);
    await openInGmail(EMAIL, "NEWTHREAD");

    expect(ext.tabs.update).toHaveBeenLastCalledWith(2, {
      url: "https://mail.google.com/mail/u/0/#all/NEWTHREAD",
      active: true,
    });
    expect(ext.tabs.create).not.toHaveBeenCalled();
  });

  it("re-pins with a full authuser navigation when the reused tab is not the pinned one", async () => {
    // Pin tab 2.
    vi.mocked(ext.tabs.query).mockResolvedValue([
      tab({ id: 2, active: true, url: "https://mail.google.com/mail/u/0/#inbox" }),
    ]);
    await openInGmail(EMAIL, THREAD);

    // A different Gmail tab (id 9, possibly another account) is now focused: it is
    // not pinned, so it must be navigated by authuser, not hash-swapped blindly.
    vi.mocked(ext.tabs.query).mockResolvedValue([
      tab({ id: 2, active: false, url: "https://mail.google.com/mail/u/0/#all/OLD" }),
      tab({ id: 9, active: true, url: "https://mail.google.com/mail/u/1/#inbox" }),
    ]);
    await openInGmail(EMAIL, "NEWTHREAD");

    expect(ext.tabs.update).toHaveBeenLastCalledWith(9, {
      url: "https://mail.google.com/mail/?authuser=user%40example.com#all/NEWTHREAD",
      active: true,
    });
  });
});

describe("openInOutlook", () => {
  const WEBLINK = "https://outlook.office365.com/owa/?ItemID=abc";
  const OUTLOOK_URL = "https://outlook.office365.com/owa/?ItemID=abc&ispopout=0";

  beforeEach(() => {
    vi.mocked(ext.tabs.query).mockReset();
    vi.mocked(ext.tabs.update).mockReset();
    vi.mocked(ext.tabs.create).mockClear();
  });

  it("opens a new tab when no Outlook tab exists", async () => {
    vi.mocked(ext.tabs.query).mockResolvedValue([]);

    await openInOutlook(WEBLINK);

    expect(ext.tabs.create).toHaveBeenCalledWith({ url: OUTLOOK_URL });
    expect(ext.tabs.update).not.toHaveBeenCalled();
  });

  it("matches all three OWA hosts so an office365/live tab is found", async () => {
    vi.mocked(ext.tabs.query).mockResolvedValue([]);

    await openInOutlook(WEBLINK);

    expect(ext.tabs.query).toHaveBeenCalledWith({
      url: [
        "https://outlook.office.com/*",
        "https://outlook.office365.com/*",
        "https://outlook.live.com/*",
      ],
      currentWindow: true,
    });
  });

  it("reuses an existing office365.com tab instead of opening a new one", async () => {
    vi.mocked(ext.tabs.query).mockResolvedValue([
      tab({ id: 3, active: true, url: "https://outlook.office365.com/mail/" }),
    ]);

    await openInOutlook(WEBLINK);

    expect(ext.tabs.update).toHaveBeenCalledWith(3, { url: OUTLOOK_URL, active: true });
    expect(ext.tabs.create).not.toHaveBeenCalled();
  });

  it("prefers the active OWA tab over a background one", async () => {
    vi.mocked(ext.tabs.query).mockResolvedValue([
      tab({ id: 3, active: false, url: "https://outlook.office.com/mail/" }),
      tab({ id: 4, active: true, url: "https://outlook.live.com/mail/" }),
    ]);

    await openInOutlook(WEBLINK);

    expect(ext.tabs.update).toHaveBeenCalledWith(4, { url: OUTLOOK_URL, active: true });
    expect(ext.tabs.create).not.toHaveBeenCalled();
  });
});
