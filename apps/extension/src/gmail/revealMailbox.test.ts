import { describe, it, expect, vi, beforeEach } from "vitest";
import { revealMailboxOnce, __resetMailboxReveal } from "./revealMailbox";
import { ext } from "../platform/ext";
import { resetChromeStorage } from "../test-setup";

// Landing a newly connected user in their mailbox is the one tab move the
// extension makes on its own, so the rules around it are what these cases pin
// down: never twice, never a duplicate mailbox, never a stray tab when the
// welcome page is sitting right there to be reused.
function tab(t: Partial<chrome.tabs.Tab>): chrome.tabs.Tab {
  return t as chrome.tabs.Tab;
}

const query = vi.mocked(ext.tabs.query);
const update = vi.mocked(ext.tabs.update);
const create = vi.mocked(ext.tabs.create);
const get = vi.mocked(ext.tabs.get);

/** tabs.get is overloaded (callback + promise), so its promise form needs a cast. */
function whenWelcomeTabIs(t: Partial<chrome.tabs.Tab>): void {
  get.mockResolvedValue(t as never);
}

const WELCOME_TAB_KEY = "amarnai.welcomeTabId";

beforeEach(() => {
  resetChromeStorage();
  __resetMailboxReveal();
  query.mockReset();
  update.mockReset();
  create.mockReset();
  get.mockReset();
  query.mockResolvedValue([]);
  update.mockResolvedValue({} as never);
  create.mockResolvedValue({ id: 100 } as never);
  whenWelcomeTabIs({ id: 5, url: "chrome-extension://test/welcome.html" });
});

/** Publishes a welcome tab the way the welcome page itself would. */
async function withWelcomeTab(id: number): Promise<void> {
  await ext.storage.session.set({ [WELCOME_TAB_KEY]: id });
}

describe("revealMailboxOnce", () => {
  it("reuses an open mailbox rather than opening a second one", async () => {
    query.mockResolvedValue([tab({ id: 9, active: true })]);

    await revealMailboxOnce("GMAIL", "ada@example.com");

    expect(update).toHaveBeenCalledWith(9, {
      url: "https://mail.google.com/mail/?authuser=ada%40example.com#inbox",
      active: true,
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("routes a reused tab to the connected account instead of just raising it", async () => {
    // A browser signed into two Google accounts: the open tab is on the other
    // one, and its URL cannot say so. Focusing it would show the wrong inbox.
    query.mockResolvedValue([tab({ id: 9, active: true, url: "https://mail.google.com/mail/u/0/#inbox" })]);

    await revealMailboxOnce("GMAIL", "ada@example.com");

    expect(update).toHaveBeenCalledWith(
      9,
      expect.objectContaining({ url: expect.stringContaining("authuser=ada%40example.com") }),
    );
  });

  it("navigates the welcome tab when no mailbox is open", async () => {
    await withWelcomeTab(5);

    await revealMailboxOnce("GMAIL", "ada@example.com");

    // Account-routed, so it cannot land on whichever Google account the browser
    // happens to be signed into.
    expect(update).toHaveBeenCalledWith(5, {
      url: "https://mail.google.com/mail/?authuser=ada%40example.com#inbox",
      active: true,
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("opens a tab when there is neither a mailbox nor a welcome tab", async () => {
    await revealMailboxOnce("GMAIL", "ada@example.com");

    expect(create).toHaveBeenCalledWith({
      url: "https://mail.google.com/mail/?authuser=ada%40example.com#inbox",
    });
  });

  it("sends an Outlook user to OWA with a login hint", async () => {
    await revealMailboxOnce("OUTLOOK", "ada@example.com");

    expect(create).toHaveBeenCalledWith({
      url: "https://outlook.office.com/mail/?login_hint=ada%40example.com",
    });
  });

  it("leaves the welcome tab alone once it is showing something else", async () => {
    await withWelcomeTab(5);
    whenWelcomeTabIs({ id: 5, url: "https://example.com/" });

    await revealMailboxOnce("GMAIL", "ada@example.com");

    // Hijacking a page the user navigated to themselves would be worse than the
    // extra tab.
    expect(update).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalled();
  });

  it("shrugs off a welcome tab the user has closed", async () => {
    await withWelcomeTab(5);
    get.mockRejectedValue(new Error("No tab with id: 5"));

    await revealMailboxOnce("GMAIL", "ada@example.com");

    expect(create).toHaveBeenCalled();
  });

  it("fires once per install, not on every sign-in", async () => {
    await revealMailboxOnce("GMAIL", "ada@example.com");
    expect(create).toHaveBeenCalledTimes(1);

    // A later panel open: the flag is in storage, so a returning user signing in
    // from a work tab stays where they are.
    __resetMailboxReveal();
    await revealMailboxOnce("GMAIL", "ada@example.com");

    expect(create).toHaveBeenCalledTimes(1);
  });

  it("does not race itself when two seed loads resolve together", async () => {
    await Promise.all([
      revealMailboxOnce("GMAIL", "ada@example.com"),
      revealMailboxOnce("GMAIL", "ada@example.com"),
    ]);

    expect(create).toHaveBeenCalledTimes(1);
  });

  it("stays silent when the tab APIs refuse", async () => {
    query.mockRejectedValue(new Error("no permission"));
    create.mockRejectedValue(new Error("no permission"));

    await expect(revealMailboxOnce("GMAIL", "ada@example.com")).resolves.toBeUndefined();
  });
});
