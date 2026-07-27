import { describe, it, expect, afterEach, vi } from "vitest";
import { mountSummaryWidget, removeExistingWidgets } from "./summaryWidget";
import { STRINGS } from "./strings";

afterEach(() => {
  document.body.innerHTML = "";
});

function anchorInPage(): Element {
  document.body.innerHTML = `<div id="pane"><div id="msgs"></div></div>`;
  return document.getElementById("msgs")!;
}

function shadowText(host: HTMLElement): string {
  return host.shadowRoot?.textContent ?? "";
}

describe("mountSummaryWidget", () => {
  it("mounts a shadow root immediately before the anchor", () => {
    const anchor = anchorInPage();
    const widget = mountSummaryWidget(anchor, { kind: "loading" })!;
    expect(widget.host.shadowRoot).not.toBeNull();
    expect(widget.host.nextElementSibling).toBe(anchor);
    expect(document.getElementById("pane")!.firstElementChild).toBe(widget.host);
  });

  it("returns null when the anchor is detached from the document", () => {
    const orphan = document.createElement("div");
    expect(mountSummaryWidget(orphan, { kind: "loading" })).toBeNull();
  });

  it("renders the loading state", () => {
    const widget = mountSummaryWidget(anchorInPage(), { kind: "loading" })!;
    expect(shadowText(widget.host)).toContain(STRINGS.loading);
  });

  it("transitions loading → summary in place, without remounting", () => {
    const anchor = anchorInPage();
    const widget = mountSummaryWidget(anchor, { kind: "loading" })!;
    const hostBefore = widget.host;
    widget.update({ kind: "summary", text: "Ana needs the kickoff date." });
    expect(widget.host).toBe(hostBefore);
    expect(shadowText(widget.host)).toContain("Ana needs the kickoff date.");
    expect(shadowText(widget.host)).not.toContain(STRINGS.loading);
  });

  it("renders summary text as text, never as markup", () => {
    const widget = mountSummaryWidget(anchorInPage(), {
      kind: "summary",
      text: "<img src=x onerror=alert(1)>",
    })!;
    expect(widget.host.shadowRoot!.querySelector("img")).toBeNull();
    expect(shadowText(widget.host)).toContain("<img src=x onerror=alert(1)>");
  });

  it("fires onRetry from the error state", () => {
    const onRetry = vi.fn();
    const widget = mountSummaryWidget(anchorInPage(), { kind: "loading" })!;
    widget.update({ kind: "error", onRetry });
    const button = widget.host.shadowRoot!.querySelector("button")!;
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("shows the reset date in the quota state", () => {
    const widget = mountSummaryWidget(anchorInPage(), {
      kind: "quota",
      resetsAt: "2026-08-01T00:00:00.000Z",
    })!;
    expect(shadowText(widget.host)).toContain("Aug 1");
  });

  it("keeps exactly one style block across re-renders", () => {
    const widget = mountSummaryWidget(anchorInPage(), { kind: "loading" })!;
    widget.update({ kind: "summary", text: "One." });
    widget.update({ kind: "summary", text: "Two." });
    expect(widget.host.shadowRoot!.querySelectorAll("style")).toHaveLength(1);
  });

  it("removes itself from the page on teardown", () => {
    const anchor = anchorInPage();
    const widget = mountSummaryWidget(anchor, { kind: "loading" })!;
    widget.remove();
    expect(document.body.contains(widget.host)).toBe(false);
    expect(document.getElementById("pane")!.firstElementChild).toBe(anchor);
  });
});

describe("removeExistingWidgets", () => {
  it("clears widgets left over from a previous document state", () => {
    const anchor = anchorInPage();
    mountSummaryWidget(anchor, { kind: "loading" });
    mountSummaryWidget(anchor, { kind: "loading" });
    expect(document.querySelectorAll("[data-amarnai-summary]")).toHaveLength(2);
    removeExistingWidgets();
    expect(document.querySelectorAll("[data-amarnai-summary]")).toHaveLength(0);
  });
});

describe("host-theme adaptation", () => {
  // Gmail's dark theme is a GMAIL setting, not an OS one, so the card must read
  // the actual backdrop rather than trusting prefers-color-scheme.
  it("uses the dark palette on a dark backdrop", () => {
    document.body.innerHTML = `<div id="pane" style="background-color: rgb(24, 22, 19)"><div id="msgs"></div></div>`;
    const widget = mountSummaryWidget(document.getElementById("msgs")!, {
      kind: "summary",
      text: "hi",
    })!;
    expect(widget.host.shadowRoot!.querySelector(".card")!.classList.contains("dark")).toBe(true);
  });

  it("uses the light palette on a light backdrop", () => {
    document.body.innerHTML = `<div id="pane" style="background-color: rgb(255, 255, 255)"><div id="msgs"></div></div>`;
    const widget = mountSummaryWidget(document.getElementById("msgs")!, {
      kind: "summary",
      text: "hi",
    })!;
    expect(widget.host.shadowRoot!.querySelector(".card")!.classList.contains("dark")).toBe(false);
  });

  it("keeps the palette stable across re-renders", () => {
    document.body.innerHTML = `<div id="pane" style="background-color: rgb(24, 22, 19)"><div id="msgs"></div></div>`;
    const widget = mountSummaryWidget(document.getElementById("msgs")!, { kind: "loading" })!;
    widget.update({ kind: "summary", text: "done" });
    expect(widget.host.shadowRoot!.querySelector(".card")!.classList.contains("dark")).toBe(true);
  });

  it("ignores transparent ancestors and keeps walking up", () => {
    document.body.innerHTML = `<div style="background-color: rgb(24,22,19)"><div style="background-color: rgba(0,0,0,0)"><div id="msgs"></div></div></div>`;
    const widget = mountSummaryWidget(document.getElementById("msgs")!, {
      kind: "summary",
      text: "hi",
    })!;
    expect(widget.host.shadowRoot!.querySelector(".card")!.classList.contains("dark")).toBe(true);
  });
});

describe("brand chrome", () => {
  it("renders the Amarnai eyebrow and a terracotta accent rail", () => {
    const widget = mountSummaryWidget(anchorInPage(), { kind: "summary", text: "hi" })!;
    const shadow = widget.host.shadowRoot!;
    expect(shadow.querySelector(".eyebrow")!.textContent).toBe(STRINGS.eyebrow);
    // The rail is the brand's terracotta accent, declared in the stylesheet.
    expect(shadow.querySelector("style")!.textContent).toContain("#c2683f");
  });
});

describe("bullets rendering", () => {
  it("renders a list item per bullet, as text", () => {
    const widget = mountSummaryWidget(anchorInPage(), {
      kind: "bullets",
      bullets: ["Shabbat at 19:30", "Bring documents", "Sacramento 1227"],
    })!;
    const items = widget.host.shadowRoot!.querySelectorAll("li");
    expect(items).toHaveLength(3);
    expect(items[0]!.textContent).toBe("Shabbat at 19:30");
    expect(widget.host.shadowRoot!.querySelector(".eyebrow")!.textContent).toBe(STRINGS.eyebrow);
  });

  it("escapes markup inside a bullet", () => {
    const widget = mountSummaryWidget(anchorInPage(), {
      kind: "bullets",
      bullets: ["<img src=x onerror=alert(1)>", "safe"],
    })!;
    expect(widget.host.shadowRoot!.querySelector("img")).toBeNull();
    expect(widget.host.shadowRoot!.querySelector("li")!.textContent).toContain("<img");
  });

  it("switches cleanly from bullets back to prose", () => {
    const widget = mountSummaryWidget(anchorInPage(), { kind: "bullets", bullets: ["a", "b"] })!;
    widget.update({ kind: "summary", text: "Now prose." });
    expect(widget.host.shadowRoot!.querySelectorAll("li")).toHaveLength(0);
    expect(widget.host.shadowRoot!.textContent).toContain("Now prose.");
  });
});

describe("card structure and accessibility", () => {
  it("stacks the eyebrow above the content, not beside it", () => {
    const widget = mountSummaryWidget(anchorInPage(), { kind: "summary", text: "hi" })!;
    const card = widget.host.shadowRoot!.querySelector(".card")!;
    // No `row` modifier: the summary state is a block stack, matching the
    // in-app ThreadSummaryCard so all three surfaces read identically.
    expect(card.classList.contains("row")).toBe(false);
    expect(card.firstElementChild!.classList.contains("eyebrow")).toBe(true);
  });

  it("keeps the transient states on one row", () => {
    for (const state of [
      { kind: "loading" } as const,
      { kind: "quota", resetsAt: "2026-08-01T00:00:00.000Z" } as const,
      { kind: "error", onRetry: () => {} } as const,
    ]) {
      const widget = mountSummaryWidget(anchorInPage(), state)!;
      expect(widget.host.shadowRoot!.querySelector(".card")!.classList.contains("row")).toBe(true);
    }
  });

  // A fill cannot separate the card from Gmail (1.14:1 at best), so the border
  // is load-bearing: it is the only thing clearing WCAG 1.4.11's 3.0 for a UI
  // boundary. A neutral hairline here would be an accessibility regression.
  it("draws a full accent border, not a neutral hairline", () => {
    const css = mountSummaryWidget(anchorInPage(), { kind: "summary", text: "hi" })!
      .host.shadowRoot!.querySelector("style")!.textContent!;
    expect(css).toContain("border: 1px solid var(--am-accent)");
    expect(css).toContain("border-left-width: 3px");
    expect(css).not.toContain("--am-line");
  });

  it("is exposed as a named, polite live note rather than mail content", () => {
    const card = mountSummaryWidget(anchorInPage(), { kind: "summary", text: "hi" })!
      .host.shadowRoot!.querySelector(".card")!;
    expect(card.getAttribute("role")).toBe("note");
    expect(card.getAttribute("aria-live")).toBe("polite");
    // Attribution for screen readers even though the visible eyebrow is generic.
    expect(card.getAttribute("aria-label")).toMatch(/amarnai/i);
  });

  it("keeps the note semantics across every state", () => {
    const widget = mountSummaryWidget(anchorInPage(), { kind: "loading" })!;
    widget.update({ kind: "bullets", bullets: ["a", "b"] });
    const card = widget.host.shadowRoot!.querySelector(".card")!;
    expect(card.getAttribute("role")).toBe("note");
    expect(card.getAttribute("aria-live")).toBe("polite");
  });
});
