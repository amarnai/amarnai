// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  PANEL_PROTOCOL_VERSION,
  PANEL_READY,
  PANEL_THREAD_CONTEXT,
  PANEL_VISIBILITY,
  PANEL_INSERT_DRAFT,
  PANEL_INSERT_RESULT,
  PANEL_OPEN_PANEL,
  PANEL_DISABLED,
  PANEL_FOCUS_COMMENTS,
  PANEL_COMMENTS_CHANGED,
} from "./panelProtocol";
import { attachPanelFrame, type PanelFrameLink } from "./panelFrame";

// The content-script end of the link to the panel iframe, shared by Gmail's
// sidebar and OWA's drawer.
//
// Two things here are load-bearing beyond "the messages arrive". The host has to
// speak first and keep speaking, because the frame cannot learn the host's origin
// without a message and so cannot open the conversation itself — that deadlock
// is what shipped broken once. And every inbound message is checked on BOTH the
// origin and the source, because either alone lets something else on the page
// drive the panel.

// Derived exactly as the module derives it. jsdom treats `chrome-extension:` as
// a non-special scheme and hands back an opaque "null" origin where a real
// browser gives `chrome-extension://<id>`; either way this is the one value the
// link may address, which is what the cases below are about.
const EXTENSION_ORIGIN = new URL(chrome.runtime.getURL("/")).origin;

type Posted = { message: Record<string, unknown>; targetOrigin: string };

let iframe: HTMLIFrameElement;
let posted: Posted[];
let framePostMessage: ReturnType<typeof vi.fn>;
let fakeContentWindow: object;
let insertDraft: ReturnType<typeof vi.fn>;
let openPanel: ReturnType<typeof vi.fn>;
let disabled: ReturnType<typeof vi.fn>;
let commentsChanged: ReturnType<typeof vi.fn>;
let link: PanelFrameLink;

/** Deliver a message as the browser would, with an origin we do not control. */
function deliver(data: unknown, origin = EXTENSION_ORIGIN, source: unknown = fakeContentWindow) {
  window.dispatchEvent(new MessageEvent("message", { data, origin, source: source as Window }));
}

function messagesOfType(type: string) {
  return posted.filter((p) => p.message["type"] === type);
}

beforeEach(() => {
  vi.useFakeTimers();
  posted = [];
  framePostMessage = vi.fn((message: Record<string, unknown>, targetOrigin: string) => {
    posted.push({ message, targetOrigin });
  });
  // jsdom gives an unattached iframe a null contentWindow, and the source check
  // compares against exactly that reference — so stand one in.
  fakeContentWindow = { postMessage: framePostMessage };
  iframe = document.createElement("iframe");
  Object.defineProperty(iframe, "contentWindow", {
    configurable: true,
    value: fakeContentWindow,
  });

  insertDraft = vi.fn(() => true);
  openPanel = vi.fn();
  disabled = vi.fn();
  commentsChanged = vi.fn();
  link = attachPanelFrame({
    iframe,
    onInsertDraft: insertDraft as unknown as (html: string) => boolean,
    onOpenPanel: openPanel,
    onDisabled: disabled,
    onCommentsChanged: commentsChanged,
  });
});

afterEach(() => {
  link.stop();
  vi.useRealTimers();
});

describe("attachPanelFrame — handshake", () => {
  it("says nothing until the frame loads", () => {
    expect(framePostMessage).not.toHaveBeenCalled();
  });

  it("opens with the current context and visibility once the frame loads", () => {
    iframe.dispatchEvent(new Event("load"));

    expect(posted.map((p) => p.message)).toEqual([
      { v: PANEL_PROTOCOL_VERSION, type: PANEL_THREAD_CONTEXT, context: null },
      { v: PANEL_PROTOCOL_VERSION, type: PANEL_VISIBILITY, visible: true },
    ]);
  });

  // `load` alone is not enough: the frame's listener is attached by its bundle,
  // which may still be parsing when load fires for a cached document.
  it("keeps repeating while the frame stays silent", () => {
    iframe.dispatchEvent(new Event("load"));
    posted.length = 0;

    vi.advanceTimersByTime(1_000);

    expect(messagesOfType(PANEL_THREAD_CONTEXT).length).toBeGreaterThanOrEqual(3);
  });

  it("stops repeating once the frame answers, and sends state once more", () => {
    iframe.dispatchEvent(new Event("load"));
    posted.length = 0;

    deliver({ v: PANEL_PROTOCOL_VERSION, type: PANEL_READY });
    const afterReady = posted.length;
    expect(afterReady).toBe(2); // context + visibility, as of now

    vi.advanceTimersByTime(5_000);
    expect(posted).toHaveLength(afterReady);
  });

  // Otherwise a frame that never came up leaves an interval running for the life
  // of the page.
  it("gives up rather than polling a dead frame forever", () => {
    iframe.dispatchEvent(new Event("load"));
    vi.advanceTimersByTime(60_000);
    const settled = posted.length;

    vi.advanceTimersByTime(60_000);

    expect(posted).toHaveLength(settled);
  });

  it("never targets a wildcard origin", () => {
    iframe.dispatchEvent(new Event("load"));
    link.postContext({ providerThreadId: "18f0", accountEmail: "ada@example.com" });
    link.setVisible(false);

    expect(posted.length).toBeGreaterThan(0);
    for (const { targetOrigin } of posted) {
      expect(targetOrigin).not.toBe("*");
      expect(targetOrigin).toBe(EXTENSION_ORIGIN);
    }
  });
});

describe("attachPanelFrame — who it listens to", () => {
  it("ignores a message from another origin", () => {
    deliver({ v: PANEL_PROTOCOL_VERSION, type: PANEL_OPEN_PANEL }, "https://evil.example");
    expect(openPanel).not.toHaveBeenCalled();
  });

  // A second extension-origin document on the page would otherwise pass the
  // origin check and drive the panel.
  it("ignores a message from another frame at the same origin", () => {
    deliver({ v: PANEL_PROTOCOL_VERSION, type: PANEL_OPEN_PANEL }, EXTENSION_ORIGIN, {
      notOurFrame: true,
    });
    expect(openPanel).not.toHaveBeenCalled();
  });

  it("accepts one from our own frame at our own origin", () => {
    deliver({ v: PANEL_PROTOCOL_VERSION, type: PANEL_OPEN_PANEL });
    expect(openPanel).toHaveBeenCalledTimes(1);
  });
});

// The workspace's kill switch has to reach the chrome the content script mounted,
// not just the frame's own rendering — the frame cannot remove its own embedder.
describe("attachPanelFrame — disabled relay", () => {
  it("tells the host to tear down when the panel reports it is switched off", () => {
    deliver({ v: PANEL_PROTOCOL_VERSION, type: PANEL_DISABLED });
    expect(disabled).toHaveBeenCalledTimes(1);
  });

  it("stops the handshake, so nothing keeps polling a frame about to be removed", () => {
    iframe.dispatchEvent(new Event("load"));
    posted.length = 0;

    deliver({ v: PANEL_PROTOCOL_VERSION, type: PANEL_DISABLED });
    vi.advanceTimersByTime(5_000);

    expect(posted).toEqual([]);
  });

  // Same lock as every other inbound message: neither check alone is enough.
  it("ignores a disable from another frame at the same origin", () => {
    deliver({ v: PANEL_PROTOCOL_VERSION, type: PANEL_DISABLED }, EXTENSION_ORIGIN, {
      notOurFrame: true,
    });
    expect(disabled).not.toHaveBeenCalled();
  });

  it("ignores a disable from the mail page's own origin", () => {
    deliver({ v: PANEL_PROTOCOL_VERSION, type: PANEL_DISABLED }, "https://mail.google.com");
    expect(disabled).not.toHaveBeenCalled();
  });
});

describe("attachPanelFrame — insert draft", () => {
  it("hands the html to the provider and answers with its verdict", () => {
    deliver({
      v: PANEL_PROTOCOL_VERSION,
      type: PANEL_INSERT_DRAFT,
      requestId: "insert-1",
      html: "<p>Thursday works.</p>",
    });

    expect(insertDraft).toHaveBeenCalledWith("<p>Thursday works.</p>");
    expect(messagesOfType(PANEL_INSERT_RESULT).map((p) => p.message)).toEqual([
      { v: PANEL_PROTOCOL_VERSION, type: PANEL_INSERT_RESULT, requestId: "insert-1", ok: true },
    ]);
  });

  // The panel marks a draft sent on a true, so a refusal has to travel.
  it("reports a refusal rather than claiming success", () => {
    insertDraft.mockReturnValue(false);

    deliver({
      v: PANEL_PROTOCOL_VERSION,
      type: PANEL_INSERT_DRAFT,
      requestId: "insert-7",
      html: "<p>hi</p>",
    });

    expect(messagesOfType(PANEL_INSERT_RESULT)[0]?.message).toMatchObject({
      requestId: "insert-7",
      ok: false,
    });
  });
});

describe("attachPanelFrame — state", () => {
  it("sends a context change straight through", () => {
    link.postContext({ providerThreadId: "18f0", accountEmail: "ada@example.com" });

    expect(messagesOfType(PANEL_THREAD_CONTEXT).map((p) => p.message)).toEqual([
      {
        v: PANEL_PROTOCOL_VERSION,
        type: PANEL_THREAD_CONTEXT,
        context: { providerThreadId: "18f0", accountEmail: "ada@example.com" },
      },
    ]);
  });

  // The frame may not have loaded when visibility is first known (Gmail seeds it
  // from the sidebar, OWA from storage), so the value has to survive to the
  // handshake rather than only being sent.
  it("carries a visibility set before load into the opening message", () => {
    link.setVisible(false);
    posted.length = 0;

    iframe.dispatchEvent(new Event("load"));

    expect(messagesOfType(PANEL_VISIBILITY).map((p) => p.message)).toEqual([
      { v: PANEL_PROTOCOL_VERSION, type: PANEL_VISIBILITY, visible: false },
    ]);
  });

  it("replays the latest context on the handshake, not the first", () => {
    link.postContext({ providerThreadId: "old", accountEmail: "ada@example.com" });
    link.postContext({ providerThreadId: "new", accountEmail: "ada@example.com" });
    posted.length = 0;

    iframe.dispatchEvent(new Event("load"));

    expect(messagesOfType(PANEL_THREAD_CONTEXT)[0]?.message).toMatchObject({
      context: { providerThreadId: "new", accountEmail: "ada@example.com" },
    });
  });
});

describe("attachPanelFrame — stop", () => {
  it("stops listening and stops repeating", () => {
    iframe.dispatchEvent(new Event("load"));
    link.stop();
    posted.length = 0;

    vi.advanceTimersByTime(5_000);
    deliver({ v: PANEL_PROTOCOL_VERSION, type: PANEL_OPEN_PANEL });

    expect(posted).toEqual([]);
    expect(openPanel).not.toHaveBeenCalled();
  });

  // A teardown that left the load listener behind would restart the handshake
  // for a panel that is no longer mounted.
  it("does not reopen the handshake if the frame loads afterwards", () => {
    link.stop();
    posted.length = 0;

    iframe.dispatchEvent(new Event("load"));
    vi.advanceTimersByTime(5_000);

    expect(posted).toEqual([]);
  });
});

describe("attachPanelFrame — focus comments", () => {
  it("posts the event once, targeted at the extension origin", () => {
    link.focusComments();

    const events = messagesOfType(PANEL_FOCUS_COMMENTS);
    expect(events).toHaveLength(1);
    expect(events[0]!.targetOrigin).toBe(EXTENSION_ORIGIN);
    expect(events[0]!.message).toEqual({ v: PANEL_PROTOCOL_VERSION, type: PANEL_FOCUS_COMMENTS });
  });

  it("is an event, not state: the handshake never replays it", () => {
    link.focusComments();

    // A frame (re)load replays context + visibility — and must NOT replay the
    // focus request, or a reloaded panel would spontaneously re-open comments.
    iframe.dispatchEvent(new Event("load"));
    vi.advanceTimersByTime(1000);

    expect(messagesOfType(PANEL_FOCUS_COMMENTS)).toHaveLength(1);
  });
});

describe("attachPanelFrame — comments changed nudge", () => {
  it("relays the frame's nudge to the host callback", () => {
    deliver({ v: PANEL_PROTOCOL_VERSION, type: PANEL_COMMENTS_CHANGED });
    expect(commentsChanged).toHaveBeenCalledTimes(1);
  });

  it("refuses the nudge from any other origin or source", () => {
    deliver({ v: PANEL_PROTOCOL_VERSION, type: PANEL_COMMENTS_CHANGED }, "https://evil.example");
    deliver({ v: PANEL_PROTOCOL_VERSION, type: PANEL_COMMENTS_CHANGED }, EXTENSION_ORIGIN, {});
    expect(commentsChanged).not.toHaveBeenCalled();
  });
});
