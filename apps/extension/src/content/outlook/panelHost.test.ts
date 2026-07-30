// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { startOutlookInjectedPanel } from "./panelHost";
import { resetOutlookReplyButton } from "./replyButton";
import { resetChromeStorage } from "../../test-setup";
import {
  PANEL_PROTOCOL_VERSION,
  PANEL_EMBED_PARAM,
  PANEL_THREAD_CONTEXT,
  PANEL_VISIBILITY,
} from "../core/panelProtocol";

// The OWA drawer. jsdom has no layout engine, so nothing here can check that the
// drawer is 360px wide or that it clears Fluent's dialog layer — those are QA
// rows, not assertions. What is testable is everything that decides what the
// panel is TOLD: which conversation, whether anyone is looking, and that the
// remembered state is known before the frame can ask.

const HOST_SELECTOR = "[data-amarnai-owa-panel]";

let teardown: () => void;
let framePostMessage: ReturnType<typeof vi.fn>;
let posted: Record<string, unknown>[];

function hostEl() {
  return document.querySelector<HTMLElement>(HOST_SELECTOR);
}

function shadow() {
  return hostEl()!.shadowRoot!;
}

function tab() {
  return shadow().querySelector<HTMLButtonElement>("button.tab")!;
}

function frame() {
  return shadow().querySelector<HTMLIFrameElement>("iframe")!;
}

function messagesOfType(type: string) {
  return posted.filter((m) => m["type"] === type);
}

/** The mail list with a row selected and NOTHING in the reading pane. */
function buildListOnly() {
  document.body.innerHTML = `
    <button aria-label="Account manager for ada@example.com"></button>
    <div role="main">
      <div role="list">
        <div data-convid="AAQkAD0=" aria-selected="false"></div>
        <div data-convid="AAQkAD1=" aria-selected="true"></div>
      </div>
      <div id="ReadingPaneContainerId"></div>
    </div>
  `;
}

/** The same page with the conversation actually rendered. */
function buildConversation(convId = "AAQkAD1=") {
  document.body.innerHTML = `
    <button aria-label="Account manager for ada@example.com"></button>
    <div role="main">
      <div role="list">
        <div data-convid="${convId}" aria-selected="true"></div>
      </div>
      <div id="ReadingPaneContainerId">
        <div id="ConversationReadingPaneContainer" data-convid="${convId}">
          <div class="customScrollBar"><div id="first-msg"></div></div>
        </div>
      </div>
    </div>
  `;
}

/**
 * Stand in for the frame's window. jsdom never loads a chrome-extension:// src,
 * so the real contentWindow stays null and the link would address nothing.
 */
function stubFrameWindow() {
  Object.defineProperty(frame(), "contentWindow", {
    configurable: true,
    value: { postMessage: framePostMessage },
  });
}

beforeEach(() => {
  resetChromeStorage();
  resetOutlookReplyButton(() => 50_000);
  posted = [];
  framePostMessage = vi.fn((message: Record<string, unknown>) => {
    posted.push(message);
  });
  teardown = () => {};
});

afterEach(() => {
  teardown();
  document.body.innerHTML = "";
  // The deeplink tests move the document's route; put it back so nothing else
  // reads itself as that layout.
  window.history.replaceState({}, "", "/");
});

describe("startOutlookInjectedPanel — mounting", () => {
  it("puts exactly one host on the body, with a shadow root", async () => {
    buildConversation();
    teardown = await startOutlookInjectedPanel(document);

    const hosts = document.querySelectorAll(HOST_SELECTOR);
    expect(hosts).toHaveLength(1);
    // On the body and nowhere else: position:fixed resolves against any ancestor
    // carrying a transform, and OWA's panes are full of them.
    expect(hosts[0]?.parentElement).toBe(document.body);
    expect(hostEl()?.shadowRoot).not.toBeNull();
  });

  it("loads the panel as the outlook embed", async () => {
    buildConversation();
    teardown = await startOutlookInjectedPanel(document);

    expect(frame().src).toContain("injected.html");
    expect(frame().src).toContain(`${PANEL_EMBED_PARAM}=outlook`);
  });

  // Without the delegation the panel's Copy silently rejects inside the frame.
  it("asks OWA to delegate clipboard-write, and nothing else", async () => {
    buildConversation();
    teardown = await startOutlookInjectedPanel(document);

    expect(frame().getAttribute("allow")).toBe("clipboard-write");
    // A sandbox would cut the frame off from its own token storage.
    expect(frame().hasAttribute("sandbox")).toBe(false);
  });

  it("refuses to mount a second drawer over the first", async () => {
    buildConversation();
    teardown = await startOutlookInjectedPanel(document);
    const second = await startOutlookInjectedPanel(document);

    expect(document.querySelectorAll(HOST_SELECTOR)).toHaveLength(1);
    second();
    // The stray teardown must not have taken the real drawer with it.
    expect(document.querySelectorAll(HOST_SELECTOR)).toHaveLength(1);
  });
});

describe("startOutlookInjectedPanel — the drawer", () => {
  it("starts collapsed on a first visit", async () => {
    buildConversation();
    teardown = await startOutlookInjectedPanel(document);

    expect(hostEl()?.getAttribute("data-expanded")).toBe("false");
    expect(tab().getAttribute("aria-expanded")).toBe("false");
  });

  it("expands on the tab, and says so to the panel", async () => {
    buildConversation();
    teardown = await startOutlookInjectedPanel(document);
    stubFrameWindow();
    posted.length = 0;

    tab().click();

    expect(hostEl()?.getAttribute("data-expanded")).toBe("true");
    expect(tab().getAttribute("aria-expanded")).toBe("true");
    expect(messagesOfType(PANEL_VISIBILITY)).toEqual([
      { v: PANEL_PROTOCOL_VERSION, type: PANEL_VISIBILITY, visible: true },
    ]);
  });

  it("collapses again on a second click", async () => {
    buildConversation();
    teardown = await startOutlookInjectedPanel(document);
    stubFrameWindow();

    tab().click();
    posted.length = 0;
    tab().click();

    expect(hostEl()?.getAttribute("data-expanded")).toBe("false");
    expect(messagesOfType(PANEL_VISIBILITY)).toEqual([
      { v: PANEL_PROTOCOL_VERSION, type: PANEL_VISIBILITY, visible: false },
    ]);
  });

  // An account switch and the office365.com → office.com redirect are real
  // navigations, so the drawer has to be remembered rather than reset.
  it("reopens expanded after a reload", async () => {
    buildConversation();
    teardown = await startOutlookInjectedPanel(document);
    tab().click();
    teardown();

    buildConversation();
    teardown = await startOutlookInjectedPanel(document);

    expect(hostEl()?.getAttribute("data-expanded")).toBe("true");
  });

  // The value has to be KNOWN before the frame can load, or the panel opens an
  // SSE connection for a drawer that turns out to be shut.
  it("seeds visibility from storage before the frame is addressed", async () => {
    buildConversation();
    teardown = await startOutlookInjectedPanel(document);
    tab().click();
    teardown();

    buildConversation();
    teardown = await startOutlookInjectedPanel(document);
    stubFrameWindow();
    posted.length = 0;
    // The handshake replays whatever state was recorded at mount.
    frame().dispatchEvent(new Event("load"));

    expect(messagesOfType(PANEL_VISIBILITY)[0]).toEqual({
      v: PANEL_PROTOCOL_VERSION,
      type: PANEL_VISIBILITY,
      visible: true,
    });
  });
});

describe("startOutlookInjectedPanel — what the panel is told", () => {
  // The reported bug, pinned. OWA keeps a row selected with an empty reading
  // pane, so a reader that trusted the selection alone would put the panel on a
  // thread screen for a thread nobody opened.
  it("reports the mailbox but no conversation on the list view", async () => {
    buildListOnly();
    teardown = await startOutlookInjectedPanel(document);
    stubFrameWindow();
    posted.length = 0;
    frame().dispatchEvent(new Event("load"));

    expect(messagesOfType(PANEL_THREAD_CONTEXT)[0]).toEqual({
      v: PANEL_PROTOCOL_VERSION,
      type: PANEL_THREAD_CONTEXT,
      context: { providerThreadId: null, accountEmail: "ada@example.com", refKind: "thread" },
    });
  });

  it("reports the conversation once one is open", async () => {
    buildConversation();
    teardown = await startOutlookInjectedPanel(document);
    stubFrameWindow();
    posted.length = 0;
    frame().dispatchEvent(new Event("load"));

    expect(messagesOfType(PANEL_THREAD_CONTEXT)[0]).toEqual({
      v: PANEL_PROTOCOL_VERSION,
      type: PANEL_THREAD_CONTEXT,
      context: {
        providerThreadId: "AAQkAD1=",
        accountEmail: "ada@example.com",
        refKind: "thread",
      },
    });
  });

  // The reported bug: Amarnai's own queue links land here (Microsoft's webLink,
  // and ispopout=0 does not prevent it on consumer OWA), and the panel had nothing
  // to say. This layout names no conversation anywhere in its DOM, so the id comes
  // from the route and travels as a message ref for the server to resolve.
  it("reports the deeplink read view's message id as a message ref", async () => {
    const itemId = "AAkALg_HYQDEapm-EWg0AFt";
    window.history.replaceState({}, "", `/mail/deeplink/read/${itemId}?ispopout=0`);
    // No account chrome, no data-convid, no [role=main] — exactly as load-tested.
    document.body.innerHTML = `
      <div id="ReadingPaneContainerId">
        <div id="ItemReadingPaneContainer">
          <div class="owaMailComposeEditorScrollContainer customScrollBar"></div>
        </div>
      </div>
    `;
    teardown = await startOutlookInjectedPanel(document);
    stubFrameWindow();
    posted.length = 0;
    frame().dispatchEvent(new Event("load"));

    expect(messagesOfType(PANEL_THREAD_CONTEXT)[0]).toMatchObject({
      context: { providerThreadId: itemId, accountEmail: null, refKind: "message" },
    });
  });

  // The route alone is not enough. A deeplink page that has not rendered its item
  // pane yet must not be reported, and neither must a three-pane page: sending a
  // conversation id as a message ref resolves to nothing.
  it("does not claim a message ref before the item pane renders", async () => {
    window.history.replaceState({}, "", "/mail/deeplink/read/AAkALg_HYQ");
    document.body.innerHTML = `<div id="app"></div>`;
    teardown = await startOutlookInjectedPanel(document);
    stubFrameWindow();
    posted.length = 0;
    frame().dispatchEvent(new Event("load"));

    expect(messagesOfType(PANEL_THREAD_CONTEXT)[0]).toMatchObject({
      context: { providerThreadId: null, refKind: "thread" },
    });
  });

  // A page with a conversation on it but no account chrome anywhere — OWA's
  // standalone deeplink read view, which has neither a header nor a folder tree.
  // The conversation is still reported, with a null mailbox: the panel is the
  // side that knows how many mailboxes are connected, so it is the side that
  // decides whether one can be assumed. Withholding the context here used to be
  // this host's answer, and it left that whole layout without a panel.
  it("reports the conversation with a null mailbox when the page names none", async () => {
    document.body.innerHTML = `
      <div role="main">
        <div id="ConversationReadingPaneContainer" data-convid="AAQkAD1="></div>
      </div>
    `;
    teardown = await startOutlookInjectedPanel(document);
    stubFrameWindow();
    posted.length = 0;
    frame().dispatchEvent(new Event("load"));

    expect(messagesOfType(PANEL_THREAD_CONTEXT)[0]).toMatchObject({
      context: { providerThreadId: "AAQkAD1=", accountEmail: null },
    });
  });
});

describe("startOutlookInjectedPanel — teardown", () => {
  it("takes the drawer off the page", async () => {
    buildConversation();
    teardown = await startOutlookInjectedPanel(document);

    teardown();
    teardown = () => {};

    expect(hostEl()).toBeNull();
  });
});
