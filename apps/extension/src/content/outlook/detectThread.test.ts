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

  it("returns null when the reading pane is absent", () => {
    setBody(`<div></div>`);
    expect(findOutlookInjectionAnchor()).toBeNull();
  });
});
