// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  PANEL_PROTOCOL_VERSION,
  PANEL_READY,
  PANEL_THREAD_CONTEXT,
  PANEL_VISIBILITY,
  PANEL_INSERT_DRAFT,
  PANEL_INSERT_RESULT,
} from "../content/core/panelProtocol";
import { OPEN_MAIL_THREAD_MESSAGE } from "../content/core/messaging";
import { createInjectedPanelHost, resetInjectedPanelHost } from "./panelHost";

// The handshake between the panel iframe and the content script that embedded
// it, on both providers.
//
// This is where the panel first shipped broken: the frame worked out its
// embedder from `document.referrer`, which is empty for a chrome-extension://
// iframe, so it decided it had no trusted parent, never sent its ready message,
// and sat on "Loading…" while the content script waited for that same message
// before sending any context. Both halves of that deadlock are pinned below.

const GMAIL = "https://mail.google.com";
const OWA = "https://outlook.live.com";
const OWA_WORK = "https://outlook.office.com";

/** Load the document as a given embed, the way the content script's src does. */
function asEmbed(embed: string | null) {
  const search = embed === null ? "" : `?embed=${embed}`;
  window.history.replaceState({}, "", `/injected.html${search}`);
  resetInjectedPanelHost();
}

type Posted = { message: unknown; targetOrigin: string };

let posted: Posted[];
let parentPostMessage: ReturnType<typeof vi.fn>;

/** Deliver a message as the browser would, with an origin we do not control. */
function deliver(data: unknown, origin: string, source: unknown = window.parent) {
  window.dispatchEvent(new MessageEvent("message", { data, origin, source: source as Window }));
}

beforeEach(() => {
  vi.useFakeTimers();
  // No embed parameter, so these cases run as the Gmail default. Also resets the
  // host: it is a per-document singleton and owns a window listener, so without
  // this one case's host keeps answering the next case's messages.
  asEmbed(null);
  // The chrome stub is shared across files, so its call history is not ours.
  vi.mocked(chrome.runtime.sendMessage).mockClear();
  posted = [];
  parentPostMessage = vi.fn((message: unknown, targetOrigin: string) => {
    posted.push({ message, targetOrigin });
  });
  // jsdom makes window.parent === window for a top-level document, which is what
  // the host compares event.source against.
  Object.defineProperty(window, "parent", {
    configurable: true,
    value: Object.assign(window, { postMessage: parentPostMessage }),
  });
});

afterEach(() => {
  resetInjectedPanelHost();
  vi.useRealTimers();
});

describe("createInjectedPanelHost — handshake", () => {
  it("does not announce itself before the embedder has spoken", () => {
    createInjectedPanelHost();
    // Nothing to address yet: the frame has no way to know its embedder's origin
    // until a message carries it.
    expect(parentPostMessage).not.toHaveBeenCalled();
  });

  it("adopts the embedder's origin from the first message and answers ready", () => {
    createInjectedPanelHost();

    deliver(
      { v: PANEL_PROTOCOL_VERSION, type: PANEL_THREAD_CONTEXT, context: null },
      GMAIL,
    );

    expect(posted).toEqual([
      { message: { v: PANEL_PROTOCOL_VERSION, type: PANEL_READY }, targetOrigin: GMAIL },
    ]);
  });

  // The whole point of the redesign: context has to reach the panel without the
  // frame having had to speak first.
  it("delivers the context that carried the handshake", () => {
    const host = createInjectedPanelHost();
    const listener = vi.fn();
    host.onThreadContext(listener);

    deliver(
      {
        v: PANEL_PROTOCOL_VERSION,
        type: PANEL_THREAD_CONTEXT,
        context: { providerThreadId: "18f0", accountEmail: "ada@example.com" },
      },
      GMAIL,
    );

    expect(listener).toHaveBeenCalledWith({
      providerThreadId: "18f0",
      accountEmail: "ada@example.com",
    });
  });

  it("never targets a wildcard origin", () => {
    createInjectedPanelHost();
    deliver({ v: PANEL_PROTOCOL_VERSION, type: PANEL_VISIBILITY, visible: true }, GMAIL);
    for (const { targetOrigin } of posted) expect(targetOrigin).toBe(GMAIL);
  });

  it("ignores a message from an origin that is not Gmail", () => {
    const host = createInjectedPanelHost();
    const listener = vi.fn();
    host.onThreadContext(listener);

    deliver(
      {
        v: PANEL_PROTOCOL_VERSION,
        type: PANEL_THREAD_CONTEXT,
        context: { providerThreadId: "18f0", accountEmail: "ada@example.com" },
      },
      "https://evil.example",
    );

    expect(parentPostMessage).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });

  it("ignores a message from a frame other than the embedder", () => {
    const host = createInjectedPanelHost();
    const listener = vi.fn();
    host.onThreadContext(listener);

    deliver(
      { v: PANEL_PROTOCOL_VERSION, type: PANEL_THREAD_CONTEXT, context: null },
      GMAIL,
      { notTheParent: true },
    );

    expect(listener).not.toHaveBeenCalled();
  });

  // Once an embedder is adopted, a later message from anywhere else is dropped.
  it("keeps to the adopted origin afterwards", () => {
    const host = createInjectedPanelHost();
    const listener = vi.fn();
    host.onThreadContext(listener);

    deliver({ v: PANEL_PROTOCOL_VERSION, type: PANEL_THREAD_CONTEXT, context: null }, GMAIL);
    listener.mockClear();

    deliver(
      {
        v: PANEL_PROTOCOL_VERSION,
        type: PANEL_THREAD_CONTEXT,
        context: { providerThreadId: "x", accountEmail: "y@z.com" },
      },
      "https://evil.example",
    );

    expect(listener).not.toHaveBeenCalled();
  });

  // A spinner with no end is the worst thing this frame can render.
  it("reports no conversation when the embedder never speaks", () => {
    const host = createInjectedPanelHost();
    const listener = vi.fn();
    host.onThreadContext(listener);

    vi.advanceTimersByTime(10_000);

    expect(listener).toHaveBeenCalledWith(null);
  });

  it("does not fire that fallback once the handshake lands", () => {
    const host = createInjectedPanelHost();
    const listener = vi.fn();
    host.onThreadContext(listener);

    deliver(
      {
        v: PANEL_PROTOCOL_VERSION,
        type: PANEL_THREAD_CONTEXT,
        context: { providerThreadId: "18f0", accountEmail: "ada@example.com" },
      },
      GMAIL,
    );
    listener.mockClear();

    vi.advanceTimersByTime(10_000);

    expect(listener).not.toHaveBeenCalled();
  });
});

describe("createInjectedPanelHost — insert draft", () => {
  it("relays the request and resolves on the host's answer", async () => {
    const host = createInjectedPanelHost();
    deliver({ v: PANEL_PROTOCOL_VERSION, type: PANEL_THREAD_CONTEXT, context: null }, GMAIL);

    const pending = host.insertDraft("<p>Thursday works.</p>");
    const request = posted
      .map((p) => p.message as Record<string, unknown>)
      .find((m) => m["type"] === PANEL_INSERT_DRAFT);
    expect(request).toMatchObject({ html: "<p>Thursday works.</p>" });

    deliver(
      {
        v: PANEL_PROTOCOL_VERSION,
        type: PANEL_INSERT_RESULT,
        requestId: request!["requestId"],
        ok: true,
      },
      GMAIL,
    );

    await expect(pending).resolves.toBe(true);
  });

  // A host that never answers must not leave the panel's button waiting forever.
  it("resolves false when the host never answers", async () => {
    const host = createInjectedPanelHost();
    deliver({ v: PANEL_PROTOCOL_VERSION, type: PANEL_THREAD_CONTEXT, context: null }, GMAIL);

    const pending = host.insertDraft("<p>hi</p>");
    await vi.advanceTimersByTimeAsync(11_000);
    await expect(pending).resolves.toBe(false);
  });

  it("resolves false before any embedder is known", async () => {
    const host = createInjectedPanelHost();
    await expect(host.insertDraft("<p>hi</p>")).resolves.toBe(false);
  });
});

describe("createInjectedPanelHost — open thread", () => {
  // Through the background rather than the embedder: this frame is an extension
  // document, so the tab can be navigated with chrome.tabs instead of by writing
  // Gmail's own location from a content script.
  it("asks the background to navigate the tab", () => {
    const host = createInjectedPanelHost();
    deliver({ v: PANEL_PROTOCOL_VERSION, type: PANEL_THREAD_CONTEXT, context: null }, GMAIL);
    posted.length = 0;

    host.openThread("18f0abc");

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: OPEN_MAIL_THREAD_MESSAGE,
      providerThreadId: "18f0abc",
    });
    // Nothing goes to the page: the mail host has no part in this.
    expect(posted).toEqual([]);
  });

  // The panel has already switched screens by the time this is sent, so it works
  // with or without an embedder having spoken.
  it("navigates before any embedder is known", () => {
    createInjectedPanelHost().openThread("18f0abc");

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: OPEN_MAIL_THREAD_MESSAGE,
      providerThreadId: "18f0abc",
    });
    expect(parentPostMessage).not.toHaveBeenCalled();
  });

  it("declares that it can navigate", () => {
    expect(createInjectedPanelHost().capabilities.openThread).toBe(true);
  });
});

// StrictMode runs the render that creates the host twice in development. Two
// hosts would answer the same handshake twice and leak a listener each.
describe("createInjectedPanelHost — one host per document", () => {
  it("returns the same instance and answers the handshake once", () => {
    const first = createInjectedPanelHost();
    const second = createInjectedPanelHost();
    expect(second).toBe(first);

    deliver({ v: PANEL_PROTOCOL_VERSION, type: PANEL_THREAD_CONTEXT, context: null }, GMAIL);

    const readies = posted.filter(
      (p) => (p.message as Record<string, unknown>)["type"] === PANEL_READY,
    );
    expect(readies).toHaveLength(1);
  });

  it("keeps that one instance whichever embed asked for it", () => {
    asEmbed("outlook");
    const first = createInjectedPanelHost();
    expect(createInjectedPanelHost()).toBe(first);
  });
});

// One document, two embedders. The parameter chooses which affordances the panel
// offers and which parents this frame will speak to — but it is NOT what keeps
// the frame safe, and the cases below pin that: whichever embed it claims to be,
// it still refuses every origin outside that embed's own allowlist.
describe("createInjectedPanelHost — embeds", () => {
  function handshakeFrom(origin: string) {
    const host = createInjectedPanelHost();
    const listener = vi.fn();
    host.onThreadContext(listener);
    deliver({ v: PANEL_PROTOCOL_VERSION, type: PANEL_THREAD_CONTEXT, context: null }, origin);
    return { host, listener };
  }

  it("adopts an OWA parent when it is the outlook embed", () => {
    asEmbed("outlook");
    const { listener } = handshakeFrom(OWA);

    expect(posted).toEqual([
      { message: { v: PANEL_PROTOCOL_VERSION, type: PANEL_READY }, targetOrigin: OWA },
    ]);
    expect(listener).toHaveBeenCalledWith(null);
  });

  it("adopts every OWA host, not just the personal one", () => {
    asEmbed("outlook");
    handshakeFrom(OWA_WORK);

    expect(posted).toEqual([
      { message: { v: PANEL_PROTOCOL_VERSION, type: PANEL_READY }, targetOrigin: OWA_WORK },
    ]);
  });

  it("refuses Gmail when it is the outlook embed", () => {
    asEmbed("outlook");
    const { listener } = handshakeFrom(GMAIL);

    expect(parentPostMessage).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });

  it("refuses OWA when it is the gmail embed", () => {
    asEmbed("gmail");
    const { listener } = handshakeFrom(OWA);

    expect(parentPostMessage).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });

  it("falls back to gmail for an unrecognised value", () => {
    asEmbed("outl00k");
    handshakeFrom(GMAIL);

    expect(posted).toEqual([
      { message: { v: PANEL_PROTOCOL_VERSION, type: PANEL_READY }, targetOrigin: GMAIL },
    ]);
  });

  it("falls back to gmail with no parameter at all", () => {
    asEmbed(null);
    handshakeFrom(GMAIL);

    expect(posted).toEqual([
      { message: { v: PANEL_PROTOCOL_VERSION, type: PANEL_READY }, targetOrigin: GMAIL },
    ]);
  });

  // OWA's conversation id is not URL-resolvable, so the queue links out instead
  // of asking this host to navigate. Everything else the embed can still do.
  it("declares that the outlook embed cannot show a conversation in place", () => {
    asEmbed("outlook");
    expect(createInjectedPanelHost().capabilities).toEqual({
      insertDraft: true,
      signIn: true,
      openExternal: true,
      openThread: false,
    });
  });

  it("declares that the gmail embed can", () => {
    asEmbed("gmail");
    expect(createInjectedPanelHost().capabilities).toEqual({
      insertDraft: true,
      signIn: true,
      openExternal: true,
      openThread: true,
    });
  });
});
