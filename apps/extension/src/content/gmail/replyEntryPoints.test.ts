import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  ensureReplyEntryPoints,
  disableReplyEntryPoints,
  resetReplyEntryPoints,
  ENTRY_ATTRIBUTE,
} from "./replyEntryPoints";
import { consumeArmedReply, setArmedReplyClock } from "./armedReply";
import { REPLY_BUTTON_STRINGS } from "../core/strings";

// A minimal Gmail conversation the injector's selectors recognise:
// role=main containing a rendered message (findConversationRoot's contract),
// a thread id attribute, the bottom bar's Reply/Reply all/Forward pills, and a
// header reply arrow.
function buildGmail({
  replyAll = true,
  header = true,
  bar = true,
  headerVariant = "three-dot" as "three-dot" | "arrow-only",
} = {}): {
  main: HTMLElement;
  nativeReply: HTMLElement | null;
  headerMore: HTMLElement | null;
  headerArrow: HTMLElement | null;
} {
  document.body.innerHTML = "";
  const main = document.createElement("div");
  main.setAttribute("role", "main");

  const message = document.createElement("div");
  message.setAttribute("data-legacy-message-id", "m1");
  message.setAttribute("data-legacy-thread-id", "18f0abc");
  main.appendChild(message);

  let headerMore: HTMLElement | null = null;
  let headerArrow: HTMLElement | null = null;
  if (header) {
    if (headerVariant === "three-dot") {
      // The shape InboxSDK's own driver selects on: tr.acZ holding the
      // three-dot menu button.
      const table = document.createElement("table");
      const row = table.insertRow();
      row.className = "acZ";
      const cell = row.insertCell();
      headerMore = document.createElement("div");
      headerMore.className = "T-I J-J5-Ji aap L3";
      headerMore.setAttribute("role", "button");
      headerMore.setAttribute("aria-haspopup", "true");
      cell.appendChild(headerMore);
      message.appendChild(table);
    } else {
      const actions = document.createElement("div");
      headerArrow = document.createElement("div");
      headerArrow.className = "T-I J-J5-Ji aaq L3";
      actions.appendChild(headerArrow);
      message.appendChild(actions);
    }
  }

  let nativeReply: HTMLElement | null = null;
  if (bar) {
    const barRow = document.createElement("div");
    barRow.className = "amn";
    nativeReply = document.createElement("span");
    nativeReply.className = "ams bkH";
    nativeReply.textContent = "Reply";
    barRow.appendChild(nativeReply);
    if (replyAll) {
      const all = document.createElement("span");
      all.className = "ams bkI";
      all.textContent = "Reply all";
      barRow.appendChild(all);
    }
    const fwd = document.createElement("span");
    fwd.className = "ams bkG";
    fwd.textContent = "Forward";
    barRow.appendChild(fwd);
    main.appendChild(barRow);
  }

  document.body.appendChild(main);
  return { main, nativeReply, headerMore, headerArrow };
}

const barButton = () => document.querySelector<HTMLElement>(`[${ENTRY_ATTRIBUTE}="bar"]`);
const headerButton = () => document.querySelector<HTMLElement>(`[${ENTRY_ATTRIBUTE}="header"]`);

beforeEach(() => {
  resetReplyEntryPoints();
  setArmedReplyClock(() => 5_000);
  consumeArmedReply(null); // drain
  vi.stubGlobal("chrome", {
    runtime: { getURL: (p: string) => `chrome-extension://abc/${p}` },
  });
});

describe("ensureReplyEntryPoints", () => {
  it("injects the pill after Reply all, labeled Amarnai Reply", () => {
    buildGmail();
    ensureReplyEntryPoints();

    const pill = barButton();
    expect(pill).not.toBeNull();
    expect(pill!.textContent).toContain(REPLY_BUTTON_STRINGS.idle);
    expect(pill!.previousElementSibling?.className).toContain("bkI");
  });

  it("injects one stylesheet that disarms the borrowed class's pseudo-elements", () => {
    // .ams::before is Gmail's built-in icon slot — the invisible space inside
    // the pill that no sibling measurement could see. It must be dead, and the
    // stylesheet must not stack up across ticks.
    buildGmail();
    ensureReplyEntryPoints();
    ensureReplyEntryPoints();

    const sheets = document.head.querySelectorAll("style[data-amarnai-entry-styles]");
    expect(sheets).toHaveLength(1);
    const css = sheets[0]!.textContent ?? "";
    expect(css).toContain("::before");
    expect(css).toContain("content: none !important");
    // Gmail applies hover through JS-toggled classes injected elements never
    // get; the stylesheet supplies the equivalent wash for both buttons.
    expect(css).toContain(':hover');
  });

  it("uses an inline SVG icon on both buttons, never an extension URL", () => {
    buildGmail();
    ensureReplyEntryPoints();
    for (const el of [barButton()!, headerButton()!]) {
      expect(el.querySelector("svg")).not.toBeNull();
      expect(el.querySelector("img")).toBeNull();
    }
  });

  it("carries the 'Reply with Amarnai' tooltip on both buttons", () => {
    buildGmail();
    ensureReplyEntryPoints();
    for (const el of [barButton()!, headerButton()!]) {
      // data-tooltip drives Gmail's own hover tooltip; aria-label the readers.
      expect(el.getAttribute("data-tooltip")).toBe(REPLY_BUTTON_STRINGS.entryTooltip);
      expect(el.getAttribute("aria-label")).toBe(REPLY_BUTTON_STRINGS.entryTooltip);
      // No title: it would double up with Gmail's tooltip.
      expect(el.hasAttribute("title")).toBe(false);
    }
    // The header icon's tooltip renders above it, like Gmail's own header
    // action icons; the bar pill keeps Gmail's default placement.
    expect(headerButton()!.getAttribute("data-tooltip-align")).toBe("t,c");
    expect(barButton()!.hasAttribute("data-tooltip-align")).toBe(false);
  });

  it("sits after Reply when there is no Reply all", () => {
    buildGmail({ replyAll: false });
    ensureReplyEntryPoints();
    expect(barButton()!.previousElementSibling?.className).toContain("bkH");
  });

  it("borrows the native pill styling but not its action hook", () => {
    buildGmail();
    ensureReplyEntryPoints();
    const pill = barButton()!;
    expect(pill.className).toContain("ams");
    expect(pill.className).not.toContain("bkH");
  });

  it("injects the header icon before the three-dot menu (SDK-anchored path)", () => {
    buildGmail();
    ensureReplyEntryPoints();
    const icon = headerButton();
    expect(icon).not.toBeNull();
    expect(icon!.nextElementSibling?.className).toContain("aap");
    // Styling borrowed from the anchor, minus its action-specific class.
    expect(icon!.className).toContain("T-I");
    expect(icon!.className).not.toContain("aap");
  });

  it("falls back to the .aaq reply arrow on older header DOMs", () => {
    buildGmail({ headerVariant: "arrow-only" });
    ensureReplyEntryPoints();
    const icon = headerButton();
    expect(icon).not.toBeNull();
    expect(icon!.nextElementSibling?.className).toContain("aaq");
  });

  it("skips the header icon when there is no native Reply to drive", () => {
    buildGmail({ bar: false });
    ensureReplyEntryPoints();
    expect(headerButton()).toBeNull();
  });

  it("anchors structurally when Gmail's classes are gone (current Gmail)", () => {
    // No tr.acZ, no .aaq. Two popup buttons, like the live 2026-07-27 DOM:
    // the recipient line's "show details" chevron (alone, first in DOM order)
    // and the action cluster's three-dot (among star/emoji/reply buttons).
    // Anchoring on the first put our icon in the recipient line — the cluster
    // must win.
    const { main } = buildGmail({ header: false });
    const message = main.querySelector("[data-legacy-message-id]")!;

    const recipientLine = document.createElement("div");
    const chevron = document.createElement("div");
    chevron.setAttribute("role", "button");
    chevron.setAttribute("aria-haspopup", "true");
    recipientLine.appendChild(chevron);
    message.appendChild(recipientLine);

    const cluster = document.createElement("div");
    for (let i = 0; i < 3; i++) {
      const b = document.createElement("div");
      b.setAttribute("role", "button"); // star, emoji, reply arrow
      cluster.appendChild(b);
    }
    const menu = document.createElement("div");
    menu.className = "xyz-unknown-classes";
    menu.setAttribute("role", "button");
    menu.setAttribute("aria-haspopup", "true");
    cluster.appendChild(menu);
    message.appendChild(cluster);

    ensureReplyEntryPoints();

    const icon = headerButton();
    expect(icon).not.toBeNull();
    expect(icon!.nextElementSibling).toBe(menu);
    expect(recipientLine.querySelector(`[${ENTRY_ATTRIBUTE}]`)).toBeNull();
    // Unknown classes are NOT borrowed — they may paint the anchor's own glyph.
    expect(icon!.className).not.toContain("xyz-unknown-classes");
  });

  it("matches a three-dot that declares aria-haspopup='menu', not 'true'", () => {
    const { main } = buildGmail({ header: false });
    const message = main.querySelector("[data-legacy-message-id]")!;
    const cluster = document.createElement("div");
    for (let i = 0; i < 3; i++) {
      const b = document.createElement("div");
      b.setAttribute("role", "button");
      cluster.appendChild(b);
    }
    const menu = document.createElement("div");
    menu.setAttribute("role", "button");
    menu.setAttribute("aria-haspopup", "menu");
    cluster.appendChild(menu);
    message.appendChild(cluster);

    ensureReplyEntryPoints();
    expect(headerButton()!.nextElementSibling).toBe(menu);
  });

  it("anchors at the cluster's last button when no button declares a popup", () => {
    // The recipient chevron is absent and the three-dot has no aria-haspopup:
    // the cluster itself is still findable, and its last button is the menu.
    const { main } = buildGmail({ header: false });
    const message = main.querySelector("[data-legacy-message-id]")!;
    const cluster = document.createElement("div");
    const buttons = [];
    for (let i = 0; i < 4; i++) {
      const b = document.createElement("div");
      b.setAttribute("role", "button");
      cluster.appendChild(b);
      buttons.push(b);
    }
    message.appendChild(cluster);

    ensureReplyEntryPoints();
    expect(headerButton()!.nextElementSibling).toBe(buttons[3]);
  });

  it("prefers the header cluster over button-shaped markup in the email body", () => {
    const { main } = buildGmail({ header: false });
    const message = main.querySelector("[data-legacy-message-id]")!;
    const cluster = document.createElement("div");
    for (let i = 0; i < 3; i++) {
      const b = document.createElement("div");
      b.setAttribute("role", "button");
      cluster.appendChild(b);
    }
    message.appendChild(cluster);
    // Untrusted body content later in DOM order, also cluster-shaped.
    const body = document.createElement("div");
    for (let i = 0; i < 3; i++) {
      const b = document.createElement("div");
      b.setAttribute("role", "button");
      body.appendChild(b);
    }
    message.appendChild(body);

    ensureReplyEntryPoints();
    expect(cluster.contains(headerButton()!.nextElementSibling)).toBe(true);
  });

  it("falls back to the lone popup button when no cluster exists", () => {
    const { main } = buildGmail({ header: false });
    const message = main.querySelector("[data-legacy-message-id]")!;
    const menu = document.createElement("div");
    menu.setAttribute("role", "button");
    menu.setAttribute("aria-haspopup", "true");
    message.appendChild(menu);

    ensureReplyEntryPoints();
    expect(headerButton()!.nextElementSibling).toBe(menu);
  });

  it("is idempotent across ticks", () => {
    buildGmail();
    ensureReplyEntryPoints();
    ensureReplyEntryPoints();
    ensureReplyEntryPoints();
    expect(document.querySelectorAll(`[${ENTRY_ATTRIBUTE}="bar"]`)).toHaveLength(1);
    expect(document.querySelectorAll(`[${ENTRY_ATTRIBUTE}="header"]`)).toHaveLength(1);
  });

  it("skips a missing surface without touching the other", () => {
    buildGmail({ header: false });
    ensureReplyEntryPoints();
    expect(barButton()).not.toBeNull();
    expect(headerButton()).toBeNull();
  });

  it("injects nothing outside a conversation", () => {
    document.body.innerHTML = "<div role='main'><div class='amn'></div></div>";
    ensureReplyEntryPoints();
    expect(document.querySelector(`[${ENTRY_ATTRIBUTE}]`)).toBeNull();
  });

  it("re-injects after Gmail re-renders the bar (compose discarded)", () => {
    const { main } = buildGmail();
    ensureReplyEntryPoints();
    main.querySelector(".amn")!.remove();

    const barRow = document.createElement("div");
    barRow.className = "amn";
    const reply = document.createElement("span");
    reply.className = "ams bkH";
    barRow.appendChild(reply);
    main.appendChild(barRow);

    ensureReplyEntryPoints();
    expect(barButton()).not.toBeNull();
  });
});

describe("activation", () => {
  it("arms the open thread and clicks Gmail's own Reply", () => {
    const { nativeReply } = buildGmail();
    const nativeClick = vi.fn();
    nativeReply!.addEventListener("click", nativeClick);
    ensureReplyEntryPoints();

    barButton()!.click();

    expect(nativeClick).toHaveBeenCalledOnce();
    // The compose that opens for this thread consumes the arm.
    expect(consumeArmedReply("18f0abc")).not.toBeNull();
  });

  it("the header icon opens the reply via the bottom bar's native Reply", () => {
    // One battle-tested click target for both buttons: the bottom Reply pill.
    const { nativeReply, headerMore } = buildGmail();
    const nativeClick = vi.fn();
    const moreClick = vi.fn();
    nativeReply!.addEventListener("click", nativeClick);
    headerMore!.addEventListener("click", moreClick);
    ensureReplyEntryPoints();

    headerButton()!.click();

    expect(nativeClick).toHaveBeenCalledOnce();
    expect(moreClick).not.toHaveBeenCalled();
    expect(consumeArmedReply("18f0abc")).not.toBeNull();
  });

  it("activates from the keyboard", () => {
    const { nativeReply } = buildGmail();
    const nativeClick = vi.fn();
    nativeReply!.addEventListener("click", nativeClick);
    ensureReplyEntryPoints();

    barButton()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(nativeClick).toHaveBeenCalledOnce();
  });
});

describe("disableReplyEntryPoints", () => {
  it("removes both buttons and stops future injection", () => {
    buildGmail();
    ensureReplyEntryPoints();
    expect(barButton()).not.toBeNull();

    disableReplyEntryPoints();
    expect(document.querySelector(`[${ENTRY_ATTRIBUTE}]`)).toBeNull();

    ensureReplyEntryPoints();
    expect(document.querySelector(`[${ENTRY_ATTRIBUTE}]`)).toBeNull();
  });
});
