import { describe, it, expect, beforeEach, vi } from "vitest";
import { OPEN_MAIL_THREAD_MESSAGE } from "../content/core/messaging";
import { registerOpenMailThreadHandler } from "./openThreadHandler";

// The click that opens a conversation from the injected panel's queue.
//
// This is the whole navigation, and it deliberately does not touch the mail page:
// the panel is an extension frame, so it sends one message and the tab it is
// embedded in is navigated with the browser's own API — the same way the side
// panel has always opened a thread.

type Listener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
) => boolean | undefined;

const GMAIL_TAB = { id: 7, url: "https://mail.google.com/mail/u/1/#inbox/OLD" };

function register(): Listener {
  registerOpenMailThreadHandler();
  const calls = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls;
  return calls[calls.length - 1]![0] as unknown as Listener;
}

function send(listener: Listener, message: unknown, tab: unknown = GMAIL_TAB) {
  return listener(message, { tab } as chrome.runtime.MessageSender);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("openThreadHandler", () => {
  it("navigates the sender's tab to the picked conversation", async () => {
    const listener = register();

    send(listener, { type: OPEN_MAIL_THREAD_MESSAGE, providerThreadId: "18f0abc" });
    await vi.waitFor(() => expect(chrome.tabs.update).toHaveBeenCalled());

    // A hash-only change, so Gmail routes it without a reload and the tab keeps
    // the account its path is already pinned to.
    expect(chrome.tabs.update).toHaveBeenCalledWith(7, {
      url: "https://mail.google.com/mail/u/1/#all/18f0abc",
    });
  });

  it("ignores messages that are not its own", () => {
    const listener = register();

    expect(send(listener, { type: "amarnai:somethingElse" })).toBe(false);
    expect(chrome.tabs.update).not.toHaveBeenCalled();
  });

  // The id lands in a URL, so a malformed one is dropped rather than navigated to.
  it("ignores a message with no usable thread id", () => {
    const listener = register();

    send(listener, { type: OPEN_MAIL_THREAD_MESSAGE, providerThreadId: "" });
    send(listener, { type: OPEN_MAIL_THREAD_MESSAGE, providerThreadId: 18 });
    send(listener, { type: OPEN_MAIL_THREAD_MESSAGE });

    expect(chrome.tabs.update).not.toHaveBeenCalled();
  });

  // Only a Gmail tab can be navigated by fragment, and only a known tab can be
  // navigated at all. Both are silent: nothing is waiting on this.
  it("does nothing when the sender is not a Gmail tab", () => {
    const listener = register();

    // A message from something that is not a tab at all (the panel document).
    send(listener, { type: OPEN_MAIL_THREAD_MESSAGE, providerThreadId: "18f0abc" }, null);
    send(listener, { type: OPEN_MAIL_THREAD_MESSAGE, providerThreadId: "18f0abc" }, { id: 7 });
    send(
      listener,
      { type: OPEN_MAIL_THREAD_MESSAGE, providerThreadId: "18f0abc" },
      { id: 7, url: "https://example.com/" },
    );

    expect(chrome.tabs.update).not.toHaveBeenCalled();
  });

  // A refused navigation must not throw out of the listener or reach the page.
  it("swallows a navigation the browser refuses", async () => {
    vi.mocked(chrome.tabs.update).mockRejectedValueOnce(new Error("no such tab"));
    const listener = register();

    expect(() =>
      send(listener, { type: OPEN_MAIL_THREAD_MESSAGE, providerThreadId: "18f0abc" }),
    ).not.toThrow();
    await vi.waitFor(() => expect(chrome.tabs.update).toHaveBeenCalled());
  });
});
