import { describe, it, expect, vi, beforeEach } from "vitest";
import { focusMailTab, closeTab } from "./focusMailTab";
import { ext } from "../platform/ext";

// Ending a checkout by focusing the user's existing mailbox tab is something
// only the extension can do: a web page has no way to raise another tab, and
// would spawn a duplicate mailbox beside the one the panel is docked against.

// The shared `ext` shim resolves the browser namespace at import time, so the
// spies go on it rather than on a re-stubbed global.
/** Partial tab literals, as the sibling openInGmail test does. */
function tab(t: Partial<chrome.tabs.Tab>): chrome.tabs.Tab {
  return t as chrome.tabs.Tab;
}

const query = vi.mocked(ext.tabs.query);
const update = vi.mocked(ext.tabs.update);
const remove = vi.mocked(ext.tabs.remove);

beforeEach(() => {
  query.mockReset();
  update.mockReset();
  remove.mockReset();
  query.mockResolvedValue([]);
  update.mockResolvedValue({} as never);
  remove.mockResolvedValue(undefined as never);
});

describe("focusMailTab", () => {
  it("raises the active Gmail tab in this window", async () => {
    query.mockResolvedValue([tab({ id: 7, active: false }), tab({ id: 9, active: true })]);

    expect(await focusMailTab("GMAIL")).toBe(true);
    expect(query).toHaveBeenCalledWith({
      url: "https://mail.google.com/*",
      currentWindow: true,
    });
    // The active one, so a user with several mailboxes lands where they were.
    expect(update).toHaveBeenCalledWith(9, { active: true });
  });

  it("falls back to the first mail tab when none is active", async () => {
    query.mockResolvedValue([tab({ id: 7, active: false })]);

    expect(await focusMailTab("GMAIL")).toBe(true);
    expect(update).toHaveBeenCalledWith(7, { active: true });
  });

  it("looks across all Outlook hosts for an Outlook mailbox", async () => {
    query.mockResolvedValue([tab({ id: 3, active: true })]);

    await focusMailTab("OUTLOOK");

    const arg = query.mock.calls[0]![0] as { url: string[] };
    expect(arg.url).toContain("https://outlook.office.com/*");
    expect(arg.url).toContain("https://outlook.office365.com/*");
    expect(arg.url).toContain("https://outlook.live.com/*");
  });

  it("opens nothing when no mailbox tab exists", async () => {
    query.mockResolvedValue([]);

    // Conjuring a mailbox the user never asked for is a worse ending than
    // leaving them where they are.
    expect(await focusMailTab("GMAIL")).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it("reports failure rather than throwing when the query is refused", async () => {
    query.mockRejectedValue(new Error("no permission"));

    expect(await focusMailTab("GMAIL")).toBe(false);
  });
});

describe("closeTab", () => {
  it("closes the tab by id", async () => {
    await closeTab(42);

    expect(remove).toHaveBeenCalledWith(42);
  });

  it("shrugs off a tab the user already closed", async () => {
    remove.mockRejectedValue(new Error("No tab with id"));

    await expect(closeTab(42)).resolves.toBeUndefined();
  });
});
