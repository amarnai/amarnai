import { describe, it, expect, afterEach } from "vitest";
import {
  detectOutlookThread,
  findAccountEmail,
  findConversationId,
  findOutlookInjectionAnchor,
} from "./detectThread";

// jsdom fixtures for OWA. As on the Gmail side these lock the parsing logic; the
// selectors themselves are external facts confirmed by a manual load test.

afterEach(() => {
  document.body.innerHTML = "";
});

function setBody(html: string) {
  document.body.innerHTML = html;
}

describe("findConversationId", () => {
  it("reads data-convid from the reading pane", () => {
    setBody(`<div role="main"><div data-convid="AAQkAD0="></div></div>`);
    expect(findConversationId()).toBe("AAQkAD0=");
  });

  it("falls back to data-conversation-id", () => {
    setBody(`<div role="main"><div data-conversation-id="AAQkAD1="></div></div>`);
    expect(findConversationId()).toBe("AAQkAD1=");
  });

  it("preserves base64 punctuation verbatim (the id is sent as stored)", () => {
    const id = "AAQkADk2/g+ZTFhNzYtM2E=";
    setBody(`<div role="main"><div data-convid="${id}"></div></div>`);
    expect(findConversationId()).toBe(id);
  });

  it("returns null when nothing carries a conversation id", () => {
    setBody(`<div role="main"></div>`);
    expect(findConversationId()).toBeNull();
  });

  // The Gmail flavor of this bug shipped an accurate summary of the WRONG
  // thread: OWA's always-visible list rows each carry data-convid, so a
  // first-match query names some other conversation.
  it("prefers the selected row over other rows in the list", () => {
    setBody(`
      <div role="main">
        <div data-convid="row-1"></div>
        <div data-convid="row-2" aria-selected="true"></div>
        <div data-convid="row-3"></div>
      </div>
    `);
    expect(findConversationId()).toBe("row-2");
  });

  it("returns null when several conversations are named and none is selected", () => {
    setBody(`
      <div role="main">
        <div data-convid="row-1"></div>
        <div data-convid="row-2"></div>
      </div>
    `);
    expect(findConversationId()).toBeNull();
  });

  it("accepts an unambiguous document where all carriers agree", () => {
    setBody(`
      <div role="main">
        <div data-convid="only-one"></div>
        <span data-convid="only-one"></span>
      </div>
    `);
    expect(findConversationId()).toBe("only-one");
  });
});

describe("findAccountEmail", () => {
  it("reads the OWA account manager's aria-label", () => {
    setBody(`<button id="O365_MainLink_Me" aria-label="Account manager for Ada ada@example.com"></button>`);
    expect(findAccountEmail()).toBe("ada@example.com");
  });

  it("falls back to the folder pane's account root node (consumer OWA)", () => {
    setBody(`
      <div role="tree">
        <div role="treeitem" title="ada@example.com">ada@examp…</div>
        <div role="treeitem">Inbox</div>
        <div role="treeitem">Drafts</div>
      </div>
    `);
    expect(findAccountEmail()).toBe("ada@example.com");
  });

  it("reads a CSS-truncated account node through its full text content", () => {
    setBody(`
      <div role="tree">
        <div role="treeitem"><span>ada@example.com</span></div>
        <div role="treeitem">Archive</div>
      </div>
    `);
    expect(findAccountEmail()).toBe("ada@example.com");
  });

  it("returns null when the folder pane names several accounts", () => {
    setBody(`
      <div role="tree">
        <div role="treeitem" title="ada@example.com">ada@example.com</div>
        <div role="treeitem" title="grace@example.com">grace@example.com</div>
      </div>
    `);
    expect(findAccountEmail()).toBeNull();
  });

  it("returns null when the visible account cannot be determined", () => {
    setBody(`<div role="main"></div>`);
    expect(findAccountEmail()).toBeNull();
  });
});

describe("detectOutlookThread", () => {
  it("returns the conversation id and the visible account", () => {
    setBody(`
      <button id="O365_MainLink_Me" aria-label="Account manager for Ada ada@example.com"></button>
      <div role="main"><div data-convid="AAQkAD0="></div></div>
    `);
    expect(detectOutlookThread()).toEqual({
      providerThreadId: "AAQkAD0=",
      accountEmail: "ada@example.com",
    });
  });

  it("returns null when the reading pane is not rendered", () => {
    setBody(`<div data-convid="AAQkAD0="></div>`);
    expect(detectOutlookThread()).toBeNull();
  });

  it("returns null on a list view with no conversation open", () => {
    setBody(`<div role="main"><div role="list"></div></div>`);
    expect(detectOutlookThread()).toBeNull();
  });
});

describe("findOutlookInjectionAnchor", () => {
  it("returns the reading pane's message list", () => {
    setBody(`<div role="main"><div role="list" id="msgs"></div></div>`);
    expect(findOutlookInjectionAnchor()?.id).toBe("msgs");
  });

  it("falls back to a listbox", () => {
    setBody(`<div role="main"><div role="listbox" id="lb"></div></div>`);
    expect(findOutlookInjectionAnchor()?.id).toBe("lb");
  });

  it("anchors above the first message inside the conversation scroll region (consumer OWA)", () => {
    setBody(`
      <div role="main">
        <div id="ConversationReadingPaneContainer">
          <div id="subject-header"><span>Hiring rule</span></div>
          <div id="messages-block">
            <div class="customScrollBar"><div id="first-msg"></div></div>
          </div>
        </div>
      </div>
    `);
    expect(findOutlookInjectionAnchor()?.id).toBe("first-msg");
  });

  it("waits (returns null) while the conversation renders without its scroll region", () => {
    // Cold load: the container is up but the scroll region is not. Anchoring on
    // a sibling here would latch the card behind the floating subject header for
    // the life of the page, so the scheduler must be told to retry instead.
    setBody(`
      <div role="main">
        <div id="ConversationReadingPaneContainer">
          <div id="subject-header"><span>Hiring rule</span></div>
          <div id="messages-block"></div>
        </div>
      </div>
    `);
    expect(findOutlookInjectionAnchor()).toBeNull();
  });

  it("anchors once the scroll region appears on a later tick", () => {
    setBody(`
      <div role="main">
        <div id="ConversationReadingPaneContainer">
          <div id="subject-header"><span>Hiring rule</span></div>
          <div id="messages-block"></div>
        </div>
      </div>
    `);
    expect(findOutlookInjectionAnchor()).toBeNull();
    const block = document.getElementById("messages-block")!;
    block.innerHTML = `<div class="customScrollBar"><div id="first-msg"></div></div>`;
    expect(findOutlookInjectionAnchor()?.id).toBe("first-msg");
  });

  it("does not anchor above the subject while the messages block is missing", () => {
    // ReadingPaneContainerId is present, but no top-of-pane fallback may fire
    // while the conversation container is mid-render.
    setBody(`
      <div role="main">
        <div id="ReadingPaneContainerId">
          <div id="pane-top"></div>
          <div id="ConversationReadingPaneContainer">
            <div id="subject-header"></div>
          </div>
        </div>
      </div>
    `);
    expect(findOutlookInjectionAnchor()).toBeNull();
  });

  it("ignores the outer reading pane's own scroll region", () => {
    // #ReadingPaneContainerId itself carries `customScrollBar` on a live
    // mailbox, so a document-wide lookup mounts at the top of the whole pane,
    // behind the floating header. Only the conversation's own region counts.
    setBody(`
      <div role="main">
        <div id="ReadingPaneContainerId" class="customScrollBar">
          <div id="pane-content"></div>
        </div>
      </div>
    `);
    expect(findOutlookInjectionAnchor()).toBeNull();
  });

  it("waits through a cold load until the conversation container appears", () => {
    // Refresh / deep link: the thread id is detectable from the message list
    // long before the reading pane renders. Anchoring during that window pins
    // the card in the wrong place for the life of the page.
    setBody(`
      <div role="main">
        <div id="ReadingPaneContainerId" class="customScrollBar"></div>
      </div>
    `);
    expect(findOutlookInjectionAnchor()).toBeNull();

    const pane = document.getElementById("ReadingPaneContainerId")!;
    pane.innerHTML = `
      <div id="ConversationReadingPaneContainer">
        <div id="subject-header"></div>
        <div class="customScrollBar"><div id="first-msg"></div></div>
      </div>
    `;
    expect(findOutlookInjectionAnchor()?.id).toBe("first-msg");
  });

  it("prefers a list over the consumer-OWA anchor", () => {
    setBody(`
      <div role="main">
        <div role="list" id="msgs"></div>
        <div id="ConversationReadingPaneContainer">
          <div class="customScrollBar"><div id="first-msg"></div></div>
        </div>
      </div>
    `);
    expect(findOutlookInjectionAnchor()?.id).toBe("msgs");
  });

  it("returns null when the reading pane is absent", () => {
    setBody(`<div></div>`);
    expect(findOutlookInjectionAnchor()).toBeNull();
  });

  it("returns null when the conversation container is empty", () => {
    setBody(`<div role="main"><div id="ConversationReadingPaneContainer"></div></div>`);
    expect(findOutlookInjectionAnchor()).toBeNull();
  });
});
