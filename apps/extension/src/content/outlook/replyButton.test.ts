import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  ensureOutlookReplyButton,
  disableOutlookReplyButton,
  resetOutlookReplyButton,
  findReplyCluster,
  OWA_BUTTON_ATTRIBUTE,
} from "./replyButton";
import { REPLY_BUTTON_STRINGS } from "../core/strings";
import { GENERATE_DRAFT_MESSAGE, type GenerateDraftResponse } from "../core/messaging";

// The fixture mirrors the live outlook.live.com structure from the 2026-07-27
// screenshot: #ConversationReadingPaneContainer holding message cards, the
// conversation id on a data-convid element, and the last message ending in a
// row of [Reply] [Forward] pill buttons. The header's Reply|Reply all|Forward
// link row also exists as an earlier button cluster — the injector must pick
// the LAST cluster, not that one.
function buildOwa({ bottomRow = true } = {}): {
  pane: HTMLElement;
  nativeReply: HTMLElement | null;
  headerRow: HTMLElement;
  subjectHeader: HTMLElement;
} {
  document.body.innerHTML = "";
  // detectOutlookThread requires a [role='main'] (the reading pane) and reads
  // the account from OWA's chrome, e.g. a button whose aria-label carries the
  // address. Both live OUTSIDE the conversation container.
  const account = document.createElement("button");
  account.setAttribute("aria-label", "Account manager for ada@example.com");
  document.body.appendChild(account);

  const main = document.createElement("div");
  main.setAttribute("role", "main");
  document.body.appendChild(main);

  const pane = document.createElement("div");
  pane.id = "ConversationReadingPaneContainer";
  pane.setAttribute("data-convid", "AQQkADAw==");
  main.appendChild(pane);

  // Subject header: OUTSIDE the messages scroll region, exactly where OWA puts
  // it — with the category chip's own little button cluster. This is the thing
  // a cold load offers before the messages exist.
  const subjectHeader = document.createElement("div");
  const chipRemove = document.createElement("button");
  chipRemove.textContent = "x";
  const chipMenu = document.createElement("button");
  subjectHeader.append(chipRemove, chipMenu);
  pane.appendChild(subjectHeader);

  const scroll = document.createElement("div");
  scroll.className = "customScrollBar";
  const message = document.createElement("div");
  scroll.appendChild(message);
  pane.appendChild(scroll);

  // Header link row: Reply | Reply all | Forward (an EARLIER cluster).
  const headerRow = document.createElement("div");
  for (let i = 0; i < 3; i += 1) {
    const b = document.createElement("button");
    headerRow.appendChild(b);
  }
  message.appendChild(headerRow);

  const body = document.createElement("div");
  body.textContent = "Fine for now, thank you!";
  message.appendChild(body);

  let nativeReply: HTMLElement | null = null;
  if (bottomRow) {
    const row = document.createElement("div");
    nativeReply = document.createElement("button");
    nativeReply.textContent = "Reply";
    row.appendChild(nativeReply);
    const forward = document.createElement("button");
    forward.textContent = "Forward";
    row.appendChild(forward);
    message.appendChild(row);
  }

  return { pane, nativeReply, headerRow, subjectHeader };
}

function openEditor(): HTMLElement {
  const editor = document.createElement("div");
  editor.setAttribute("contenteditable", "true");
  editor.setAttribute("role", "textbox");
  const quote = document.createElement("div");
  quote.textContent = "-- original message --";
  editor.appendChild(quote);
  document.getElementById("ConversationReadingPaneContainer")!.appendChild(editor);
  return editor;
}

const button = () => document.querySelector<HTMLElement>(`[${OWA_BUTTON_ATTRIBUTE}]`);
const label = () => button()?.querySelector("span")?.textContent;

const DRAFT_OK: GenerateDraftResponse = {
  ok: true,
  result: { kind: "draft", draftId: "d1", body: "Thursday works." },
};

let respond: GenerateDraftResponse = DRAFT_OK;
const sendMessage = vi.fn(
  (message: { type?: string }, callback?: (r: GenerateDraftResponse) => void) => {
    if (message.type === GENERATE_DRAFT_MESSAGE) callback?.(respond);
  },
);

/** Let the click's promise chain settle. */
const settle = () => Promise.resolve().then(() => Promise.resolve());

beforeEach(() => {
  respond = DRAFT_OK;
  sendMessage.mockClear();
  resetOutlookReplyButton(() => 50_000);
  vi.stubGlobal("chrome", {
    runtime: {
      getURL: (p: string) => `chrome-extension://abc/${p}`,
      sendMessage,
      lastError: undefined,
    },
  });
});

describe("findReplyCluster", () => {
  it("picks the LAST button cluster — the bottom [Reply] [Forward] row", () => {
    const { nativeReply } = buildOwa();
    const found = findReplyCluster(document);
    expect(found?.nativeReply).toBe(nativeReply);
  });

  it("ignores the subject header's chip buttons", () => {
    // The header sits outside .customScrollBar; only the message list counts.
    const { subjectHeader } = buildOwa();
    const found = findReplyCluster(document);
    expect(found?.container).not.toBe(subjectHeader);
  });

  it("returns null on a cold load, before the messages have rendered", () => {
    // Refresh case: the subject header exists, the message list does not. The
    // button must wait rather than pin itself to the header (live bug
    // 2026-07-28 — correct on navigation, wrong after a refresh).
    buildOwa();
    document.querySelector(".customScrollBar")!.remove();
    expect(findReplyCluster(document)).toBeNull();
  });

  it("returns null outside a conversation", () => {
    document.body.innerHTML = "<div><button></button><button></button></div>";
    expect(findReplyCluster(document)).toBeNull();
  });
});

describe("ensureOutlookReplyButton", () => {
  it("appends the pill to the native row, labeled and tooltipped", () => {
    buildOwa();
    ensureOutlookReplyButton(document);

    expect(button()).not.toBeNull();
    expect(label()).toBe(REPLY_BUTTON_STRINGS.idle);
    expect(button()!.title).toBe(REPLY_BUTTON_STRINGS.tooltips.idle);
    expect(button()!.previousElementSibling?.textContent).toBe("Forward");
  });

  it("uses an inline SVG icon, never an extension URL", () => {
    // OWA refuses chrome-extension:// resources ("Denying load of…", live
    // 2026-07-28); inlining removes the web_accessible_resources dependency.
    buildOwa();
    ensureOutlookReplyButton(document);

    const svg = button()!.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg!.querySelector("polygon")?.getAttribute("fill")).toBe("currentColor");
    expect(button()!.querySelector("img")).toBeNull();
    // The clay coloring rides in one injected stylesheet, not per element.
    expect(document.head.querySelectorAll("style[data-amarnai-owa-styles]")).toHaveLength(1);
  });

  it("injects nothing on a cold load, then lands in the reply row once it renders", () => {
    const { pane } = buildOwa();
    const messages = document.querySelector(".customScrollBar")!;
    messages.remove();

    ensureOutlookReplyButton(document);
    expect(button()).toBeNull();

    pane.appendChild(messages);
    ensureOutlookReplyButton(document);
    expect(button()).not.toBeNull();
    expect(button()!.previousElementSibling?.textContent).toBe("Forward");
  });

  it("re-homes itself if an early tick placed it somewhere else", () => {
    const { subjectHeader } = buildOwa();
    ensureOutlookReplyButton(document);
    // Simulate the stranded state the cold-load bug produced.
    subjectHeader.appendChild(button()!);
    expect(subjectHeader.querySelector(`[${OWA_BUTTON_ATTRIBUTE}]`)).not.toBeNull();

    ensureOutlookReplyButton(document);

    expect(subjectHeader.querySelector(`[${OWA_BUTTON_ATTRIBUTE}]`)).toBeNull();
    expect(button()!.previousElementSibling?.textContent).toBe("Forward");
    expect(document.querySelectorAll(`[${OWA_BUTTON_ATTRIBUTE}]`)).toHaveLength(1);
  });

  it("is idempotent across ticks", () => {
    buildOwa();
    ensureOutlookReplyButton(document);
    ensureOutlookReplyButton(document);
    expect(document.querySelectorAll(`[${OWA_BUTTON_ATTRIBUTE}]`)).toHaveLength(1);
  });

  it("injects nothing when the native row is absent", () => {
    buildOwa({ bottomRow: false });
    // The header row alone must not be mistaken for the reply row?
    // It is a legitimate cluster, so the button lands there instead — the
    // point is that SOME native reply surface exists. Remove it too:
    document.querySelectorAll("button").forEach((b) => b.remove());
    ensureOutlookReplyButton(document);
    expect(button()).toBeNull();
  });
});

describe("click flow", () => {
  it("generates, opens the reply via the native button, and inserts", async () => {
    const { nativeReply } = buildOwa();
    // Clicking OWA's Reply opens the inline editor, as the real page does.
    nativeReply!.addEventListener("click", () => void openEditor());
    ensureOutlookReplyButton(document);

    button()!.click();
    await settle();
    ensureOutlookReplyButton(document); // observer tick after OWA renders

    const editor = document.querySelector('[contenteditable="true"]')!;
    expect(editor.firstElementChild?.textContent).toBe("Thursday works.");
    // The quoted original stays below the insertion.
    expect(editor.lastElementChild?.textContent).toContain("original message");
    expect(label()).toBe(REPLY_BUTTON_STRINGS.idle);
    expect(button()!.title).toBe(REPLY_BUTTON_STRINGS.tooltips.inserted);
  });

  it("holds the draft in the ready state until the editor appears", async () => {
    buildOwa();
    ensureOutlookReplyButton(document);

    button()!.click();
    await settle();
    expect(label()).toBe(REPLY_BUTTON_STRINGS.readyToInsert);

    openEditor();
    ensureOutlookReplyButton(document);
    expect(label()).toBe(REPLY_BUTTON_STRINGS.idle);
    expect(button()!.title).toBe(REPLY_BUTTON_STRINGS.tooltips.inserted);
  });

  it("inserts immediately when a compose is already open", async () => {
    buildOwa();
    openEditor();
    ensureOutlookReplyButton(document);

    button()!.click();
    await settle();
    expect(label()).toBe(REPLY_BUTTON_STRINGS.idle);
    expect(button()!.title).toBe(REPLY_BUTTON_STRINGS.tooltips.inserted);
  });

  it("re-click replaces the insertion instead of stacking a duplicate", async () => {
    buildOwa();
    const editor = openEditor();
    ensureOutlookReplyButton(document);

    button()!.click();
    await settle();
    button()!.click();
    await settle();

    const insertions = editor.querySelectorAll("div > p");
    expect(insertions).toHaveLength(1);
  });

  it("maps quota to a disabled state naming the reset date", async () => {
    respond = {
      ok: true,
      result: { kind: "quota", used: 3, limit: 3, resetsAt: "2026-08-01T00:00:00Z" },
    };
    buildOwa();
    ensureOutlookReplyButton(document);

    button()!.click();
    await settle();

    expect(label()).toBe(REPLY_BUTTON_STRINGS.quota);
    expect(button()!.title).toContain("Aug 1");
    expect(button()!.getAttribute("aria-disabled")).toBe("true");
  });

  it("shows signed-out and routes the next click to the panel", async () => {
    respond = { ok: false, reason: "signedOut" };
    buildOwa();
    ensureOutlookReplyButton(document);

    button()!.click();
    await settle();
    expect(label()).toBe(REPLY_BUTTON_STRINGS.signedOut);

    button()!.click();
    await settle();
    expect(sendMessage).toHaveBeenCalledWith({ type: "amarnai:openPanel" });
  });

  it("removes the button when the workspace has the feature off", async () => {
    respond = { ok: false, reason: "injectionDisabled" };
    buildOwa();
    ensureOutlookReplyButton(document);

    button()!.click();
    await settle();

    expect(button()).toBeNull();
    ensureOutlookReplyButton(document);
    expect(button()).toBeNull();
  });
});

describe("thread switches", () => {
  it("drops a pending draft when the open conversation changes", async () => {
    const { pane } = buildOwa();
    ensureOutlookReplyButton(document);
    button()!.click();
    await settle();
    expect(label()).toBe(REPLY_BUTTON_STRINGS.readyToInsert);

    // Another conversation opens; the held draft belongs to the previous one.
    pane.setAttribute("data-convid", "BQQkADAw==");
    ensureOutlookReplyButton(document);
    openEditor();
    ensureOutlookReplyButton(document);

    const editor = document.querySelector('[contenteditable="true"]')!;
    expect(editor.querySelector("p")).toBeNull();
    expect(label()).toBe(REPLY_BUTTON_STRINGS.idle);
  });
});

describe("disableOutlookReplyButton", () => {
  it("removes and stops future injection", () => {
    buildOwa();
    ensureOutlookReplyButton(document);
    disableOutlookReplyButton(document);
    expect(button()).toBeNull();
    ensureOutlookReplyButton(document);
    expect(button()).toBeNull();
  });
});
