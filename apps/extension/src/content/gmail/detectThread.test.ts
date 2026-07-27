import { describe, it, expect, afterEach } from "vitest";
import {
  detectGmailThread,
  findAccountEmail,
  findConversationRoot,
  findGmailInjectionAnchor,
  findThreadId,
  threadIdFromHash,
  extractEmail,
} from "./detectThread";

/** An open-conversation region: role=main containing a rendered message. */
function conversation(threadAttr: string, inner = "") {
  return `<div role="main">${threadAttr}<div data-legacy-message-id="msg-1"></div>${inner}</div>`;
}

// jsdom fixtures standing in for Gmail's markup. These are the automatable proxy
// for the manual load test: they lock the parsing logic, not the real selectors
// (which are external facts about Gmail and can only be confirmed in a browser).

afterEach(() => {
  document.body.innerHTML = "";
  window.location.hash = "";
});

function setBody(html: string) {
  document.body.innerHTML = html;
}

describe("findThreadId", () => {
  it("reads data-legacy-thread-id from the open conversation", () => {
    setBody(conversation(`<div data-legacy-thread-id="18f0abc1234567de"></div>`));
    expect(findThreadId()).toBe("18f0abc1234567de");
  });

  it("falls back to data-thread-perm-id", () => {
    setBody(conversation(`<div data-thread-perm-id="thread-f:18f0abc1234567de"></div>`));
    expect(findThreadId()).toBe("18f0abc1234567de");
  });

  it("strips Gmail's thread-f:/thread-a: prefix", () => {
    setBody(conversation(`<div data-legacy-thread-id="thread-a:18f0abc1234567de"></div>`));
    expect(findThreadId()).toBe("18f0abc1234567de");
  });

  it("prefers the legacy attribute when both are present", () => {
    setBody(conversation(`
      <div data-legacy-thread-id="1111111111111111"></div>
      <div data-thread-perm-id="2222222222222222"></div>
    `));
    expect(findThreadId()).toBe("1111111111111111");
  });

  it("returns null on a list view with no thread attribute and no usable hash", () => {
    setBody(`<div role="main"><div role="list"></div></div>`);
    window.location.hash = "#inbox";
    expect(findThreadId()).toBeNull();
  });

  // The live bug: Gmail keeps the thread list in the document, whose rows also
  // carry data-legacy-thread-id. A global first-match returned the FIRST LIST
  // ROW's id, so the widget showed an accurate summary of the wrong thread.
  it("never reads the id off a list row elsewhere in the document", () => {
    setBody(`
      <div role="main"><table><tr data-legacy-thread-id="aaaaaaaaaaaaaaaa"></tr></table></div>
      ${conversation(`<div data-legacy-thread-id="18f0abc1234567de"></div>`)}
    `);
    expect(findThreadId()).toBe("18f0abc1234567de");
  });

  it("returns null in list view even when rows carry thread ids", () => {
    setBody(`<div role="main"><table><tr data-legacy-thread-id="aaaaaaaaaaaaaaaa"></tr></table></div>`);
    window.location.hash = "#inbox";
    expect(findThreadId()).toBeNull();
  });

  it("prefers the most recent conversation region when several are in the DOM", () => {
    // Gmail preloads/keeps conversation views; jsdom has no layout so the
    // visibility check cannot discriminate — the last (newest) view wins.
    setBody(`
      ${conversation(`<div data-legacy-thread-id="1111111111111111"></div>`)}
      ${conversation(`<div data-legacy-thread-id="2222222222222222"></div>`)}
    `);
    expect(findThreadId()).toBe("2222222222222222");
  });

  it("reads the id from an ancestor of the conversation region", () => {
    setBody(`
      <div data-legacy-thread-id="18f0abc1234567de">
        <div role="main"><div data-legacy-message-id="msg-1"></div></div>
      </div>
    `);
    expect(findThreadId()).toBe("18f0abc1234567de");
  });
});

describe("findConversationRoot", () => {
  it("requires a rendered message, not just a role=main", () => {
    setBody(`<div role="main"><div role="list"></div></div>`);
    expect(findConversationRoot()).toBeNull();
  });

  it("accepts the newer data-message-id marker", () => {
    setBody(`<div role="main"><div data-message-id="#msg-f:1"></div></div>`);
    expect(findConversationRoot()).not.toBeNull();
  });
});

describe("threadIdFromHash", () => {
  it("accepts a hex thread id in the hash", () => {
    expect(threadIdFromHash("#inbox/18f0abc1234567de")).toBe("18f0abc1234567de");
  });

  it("lowercases the id", () => {
    expect(threadIdFromHash("#inbox/18F0ABC1234567DE")).toBe("18f0abc1234567de");
  });

  it("rejects the non-API tokens newer accounts put in the hash", () => {
    expect(threadIdFromHash("#inbox/FMfcgzQbdrLpKZmSjLLpQqMLBGvSbPQr")).toBeNull();
  });

  it("rejects a bare folder hash", () => {
    expect(threadIdFromHash("#inbox")).toBeNull();
    expect(threadIdFromHash("")).toBeNull();
  });
});

describe("extractEmail", () => {
  it("pulls an address out of an aria-label", () => {
    expect(extractEmail("Google Account: Ada (ada@example.com)")).toBe("ada@example.com");
  });

  it("lowercases the address", () => {
    expect(extractEmail("Ada <Ada@Example.COM>")).toBe("ada@example.com");
  });

  it("returns null when there is no address", () => {
    expect(extractEmail("Google Account")).toBeNull();
    expect(extractEmail(null)).toBeNull();
  });
});

describe("findAccountEmail", () => {
  it("reads the account switcher's aria-label", () => {
    setBody(`<a aria-label="Google Account: Ada (ada@example.com)"></a>`);
    expect(findAccountEmail()).toBe("ada@example.com");
  });

  it("returns null when the visible account cannot be determined", () => {
    setBody(`<div role="main"></div>`);
    expect(findAccountEmail()).toBeNull();
  });
});

describe("detectGmailThread", () => {
  it("returns the thread id and the visible account", () => {
    setBody(`
      <a aria-label="Google Account: Ada (ada@example.com)"></a>
      ${conversation(`<div data-legacy-thread-id="18f0abc1234567de"></div>`)}
    `);
    expect(detectGmailThread()).toEqual({
      providerThreadId: "18f0abc1234567de",
      accountEmail: "ada@example.com",
    });
  });

  it("returns null when no thread is open", () => {
    setBody(`<a aria-label="Google Account: Ada (ada@example.com)"></a>`);
    expect(detectGmailThread()).toBeNull();
  });

  // A missing account is reported as null rather than guessed: under multi-login
  // the runner treats it as "do not inject" — summarizing the wrong mailbox would
  // be worse than summarizing nothing.
  it("reports a null account rather than guessing", () => {
    setBody(conversation(`<div data-legacy-thread-id="18f0abc1234567de"></div>`));
    expect(detectGmailThread()).toEqual({
      providerThreadId: "18f0abc1234567de",
      accountEmail: null,
    });
  });
});

describe("findGmailInjectionAnchor", () => {
  it("returns the conversation's message list", () => {
    setBody(`<div role="main"><div data-legacy-message-id="m1"></div><div role="list" id="msgs"></div></div>`);
    expect(findGmailInjectionAnchor()?.id).toBe("msgs");
  });

  it("falls back to the first message row", () => {
    setBody(`<div role="main"><div data-legacy-message-id="m1" id="row"></div></div>`);
    expect(findGmailInjectionAnchor()?.id).toBe("row");
  });

  it("returns null when no conversation is open (list view)", () => {
    setBody(`<div role="main"><div role="list" id="msgs"></div></div>`);
    expect(findGmailInjectionAnchor()).toBeNull();
  });

  it("anchors into the SAME conversation region the thread id came from", () => {
    setBody(`
      ${conversation(`<div data-legacy-thread-id="1111111111111111"></div>`, `<div role="list" id="old"></div>`)}
      ${conversation(`<div data-legacy-thread-id="2222222222222222"></div>`, `<div role="list" id="new"></div>`)}
    `);
    expect(findThreadId()).toBe("2222222222222222");
    expect(findGmailInjectionAnchor()?.id).toBe("new");
  });
});
