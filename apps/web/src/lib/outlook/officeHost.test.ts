import { describe, it, expect, vi } from "vitest";
import {
  ITEM_CHANGED,
  readOutlookContext,
  subscribeOutlookContext,
  insertReplyDraft,
  type OfficeLike,
} from "./officeHost";

// A pinned task pane survives the user clicking through their inbox: the
// document stays mounted while context.mailbox.item is swapped underneath it.
// Without the ItemChanged subscription the pane keeps showing the first message
// the user opened and quietly goes stale — which is worse than showing nothing,
// because it looks correct.

type Handler = () => void;

function makeOffice(initial?: { conversationId?: string; accountEmail?: string }) {
  const handlers = new Map<string, Handler>();
  const displayed: Array<string | { htmlBody: string }> = [];

  const office = {
    onReady: vi.fn().mockResolvedValue(undefined),
    EventType: { ItemChanged: ITEM_CHANGED },
    context: {
      mailbox: {
        item: initial?.conversationId
          ? {
              conversationId: initial.conversationId,
              displayReplyForm: (reply: string | { htmlBody: string }) => displayed.push(reply),
            }
          : null,
        userProfile: { emailAddress: initial?.accountEmail ?? "ada@contoso.com" },
        addHandlerAsync: vi.fn((type: string, handler: Handler) => {
          handlers.set(type, handler);
        }),
        removeHandlerAsync: vi.fn((type: string) => {
          handlers.delete(type);
        }),
      },
    },
  } as unknown as OfficeLike;

  return {
    office,
    displayed,
    handlers,
    /** Simulate Outlook moving the pinned pane to another conversation. */
    selectItem(conversationId: string | null) {
      const mailbox = office.context.mailbox!;
      mailbox.item = conversationId
        ? {
            conversationId,
            displayReplyForm: (reply: string | { htmlBody: string }) => displayed.push(reply),
          }
        : null;
      handlers.get(ITEM_CHANGED)?.();
    },
  };
}

describe("readOutlookContext", () => {
  it("reads the open conversation and the mailbox reading it", () => {
    const { office } = makeOffice({ conversationId: "AAQkAD+abc", accountEmail: "ada@contoso.com" });
    expect(readOutlookContext(office)).toEqual({
      conversationId: "AAQkAD+abc",
      accountEmail: "ada@contoso.com",
    });
  });

  // The pane can be opened from a folder view, where there is nothing selected.
  it("returns null when no message is selected", () => {
    const { office } = makeOffice();
    expect(readOutlookContext(office)).toBeNull();
  });
});

describe("subscribeOutlookContext", () => {
  it("reports the current conversation immediately", () => {
    const { office } = makeOffice({ conversationId: "AAQkAD+abc" });
    const listener = vi.fn();
    subscribeOutlookContext(office, listener);
    expect(listener).toHaveBeenCalledWith({
      conversationId: "AAQkAD+abc",
      accountEmail: "ada@contoso.com",
    });
  });

  it("follows the pinned pane onto the next conversation", () => {
    const harness = makeOffice({ conversationId: "AAQkAD+abc" });
    const listener = vi.fn();
    subscribeOutlookContext(harness.office, listener);

    harness.selectItem("AAQkAD+def");

    expect(listener).toHaveBeenLastCalledWith({
      conversationId: "AAQkAD+def",
      accountEmail: "ada@contoso.com",
    });
  });

  it("reports null when the user navigates away from any conversation", () => {
    const harness = makeOffice({ conversationId: "AAQkAD+abc" });
    const listener = vi.fn();
    subscribeOutlookContext(harness.office, listener);

    harness.selectItem(null);

    expect(listener).toHaveBeenLastCalledWith(null);
  });

  it("unsubscribes on teardown", () => {
    const harness = makeOffice({ conversationId: "AAQkAD+abc" });
    const unsubscribe = subscribeOutlookContext(harness.office, vi.fn());
    unsubscribe();
    expect(harness.office.context.mailbox?.removeHandlerAsync).toHaveBeenCalledWith(ITEM_CHANGED);
  });

  // An unpinned pane in an older host is torn down and rebuilt per message, so
  // losing the subscription costs nothing — but it must not throw.
  it("still reports the current conversation on a host with no addHandlerAsync", () => {
    const { office } = makeOffice({ conversationId: "AAQkAD+abc" });
    delete office.context.mailbox!.addHandlerAsync;
    const listener = vi.fn();
    expect(() => subscribeOutlookContext(office, listener)).not.toThrow();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("survives a host that refuses the subscription", () => {
    const { office } = makeOffice({ conversationId: "AAQkAD+abc" });
    office.context.mailbox!.addHandlerAsync = () => {
      throw new Error("not supported");
    };
    const listener = vi.fn();
    expect(() => subscribeOutlookContext(office, listener)).not.toThrow();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  // Some hosts spell the constant differently; the pane reads it off Office
  // rather than hardcoding it, and falls back only when it is absent.
  it("subscribes with the host's own event constant", () => {
    const { office } = makeOffice({ conversationId: "AAQkAD+abc" });
    office.EventType = { ItemChanged: "customItemChanged" };
    subscribeOutlookContext(office, vi.fn());
    expect(office.context.mailbox?.addHandlerAsync).toHaveBeenCalledWith(
      "customItemChanged",
      expect.any(Function),
    );
  });
});

describe("insertReplyDraft", () => {
  // The add-in's only mailbox write. It opens Outlook's own compose; nothing
  // here can send.
  it("hands the html to Outlook's reply form", () => {
    const harness = makeOffice({ conversationId: "AAQkAD+abc" });
    insertReplyDraft(harness.office, "<p>Thursday works.</p>");
    expect(harness.displayed).toEqual([{ htmlBody: "<p>Thursday works.</p>" }]);
  });

  it("throws rather than silently dropping the draft with no item open", () => {
    const { office } = makeOffice();
    expect(() => insertReplyDraft(office, "<p>hi</p>")).toThrow("no-item");
  });
});
