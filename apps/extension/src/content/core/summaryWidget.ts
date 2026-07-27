import { STRINGS, formatResetDate } from "./strings.js";

// Framework-free summary card injected into the mail page.
//
// Shadow DOM with an inlined <style> block: the page is Gmail's or OWA's, so
// none of the app's design tokens exist there and none of our class names are
// safe from theirs. A closed-off shadow root is the only way to guarantee the
// widget looks the same everywhere and cannot leak styles into the host page.
//
// The palette echoes em-summary-card without importing it, and follows the
// viewer's OS colour scheme.

export type WidgetState =
  | { kind: "loading" }
  | { kind: "summary"; text: string }
  | { kind: "bullets"; bullets: string[] }
  | { kind: "error"; onRetry: () => void }
  | { kind: "quota"; resetsAt: string };

const HOST_ATTRIBUTE = "data-amarnai-summary";

// Amarnai brand tokens, inlined because the mail page has none of our CSS vars.
// Light values are packages/tokens colors.ts verbatim; dark values are the
// html[data-theme="dark"] oklch tokens converted to sRGB. Keep both in step with
// the token package — this is the one place the palette is duplicated, and it is
// duplicated because a third-party page cannot import it.
const LIGHT = {
  surface: "#faf9f6", // --bg
  text: "#4d4843", // --ink-2   8.6:1 on surface
  muted: "#706c66", // --ink-3  5.0:1 on surface
  accent: "#c2683f", // --accent
  accentInk: "#7b3a1d", // --accent-ink
  hover: "#f3f0ea", // --bg-sunk
};
const DARK = {
  // Lifted to oklch(27%): the app's rule is that surfaces rise above the canvas,
  // and Gmail's dark canvas is ~#1f1f1f — the previous #1e1d1a sank BELOW it, so
  // the card read as a hole rather than a raised annotation. Muted text is 4.50:1
  // here, exactly AA; do not darken the text or lighten this surface further.
  surface: "#282623",
  text: "#bab7b2", // 7.6:1 on surface
  muted: "#8f8c87", // 4.50:1 on surface
  accent: "#c65d36",
  accentInk: "#e6af9c",
  hover: "#35322f",
};

function paletteVars(p: typeof LIGHT): string {
  return `
    --am-surface: ${p.surface};
    --am-text: ${p.text};
    --am-muted: ${p.muted};
    --am-accent: ${p.accent};
    --am-accent-ink: ${p.accentInk};
    --am-hover: ${p.hover};`;
}

// Design intent: unmistakably Amarnai while sitting quietly inside Gmail.
//
// The border does ALL the work of defining the card, because a fill cannot: the
// most separation any surface achieves against Gmail's own background is 1.14:1
// (measured), i.e. invisible. A neutral hairline was no better (1.06-1.21:1,
// failing WCAG 1.4.11's 3.0 minimum for UI boundaries). A terracotta border is
// the only value that clears 3.0 against Gmail light AND both Gmail darks
// (3.85-4.20:1), so it is simultaneously the accessible choice and the brand one.
// The heavier left edge keeps the blockquote/callout read - this is an
// annotation, not mail content, and in a mail client that distinction matters.
//
// Body text inherits the mail app's own font stack (page @font-face rules reach
// into shadow roots), so the summary reads as part of the client rather than
// pasted in; only the eyebrow uses our mono voice.
const STYLES = `
:host { all: initial; display: block; }
.card {
  ${paletteVars(LIGHT)}
  font-family: "Google Sans", Roboto, system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: 13px;
  line-height: 1.55;
  margin: 6px 0 10px 12px;
  padding: 9px 13px 10px 12px;
  border: 1px solid var(--am-accent);
  border-left-width: 3px;
  border-radius: 10px;
  background: var(--am-surface);
  color: var(--am-text);
}
.card.dark { ${paletteVars(DARK)} }
/* The transient states are a label plus one control - a row, not a stack. */
.card.row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.body { flex: 1 1 auto; min-width: 0; }
/* Stacked above the content, matching the in-app card so all three surfaces
   read identically. Costs ~13px, not a full line, and gives the text (and
   especially a bullet list) the full measure in a narrow reading pane. */
.eyebrow {
  display: block;
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  font-size: 9.5px;
  font-weight: 500;
  line-height: 1;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--am-accent-ink);
  margin-bottom: 4px;
}
.card.row .eyebrow { margin-bottom: 0; flex: 0 0 auto; }
.text { overflow-wrap: anywhere; }
/* Tighter than the in-app list: vertical space is the scarce resource here,
   since every line pushes the actual conversation further down the page. */
.bullets {
  margin: 0;
  padding-left: 15px;
  overflow-wrap: anywhere;
}
.bullets li { margin: 0; padding: 0; }
.bullets li + li { margin-top: 1px; }
.bullets li::marker { color: var(--am-muted); }
.muted { color: var(--am-muted); }
.pulse {
  width: 5px; height: 5px; border-radius: 50%;
  background: var(--am-accent);
  animation: amarnai-pulse 1.6s ease-in-out infinite;
  flex: 0 0 auto;
  align-self: center;
}
@keyframes amarnai-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
.retry {
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  border: 1px solid var(--am-accent);
  border-radius: 6px;
  background: transparent;
  color: var(--am-accent-ink);
  padding: 2px 9px;
  flex: 0 0 auto;
}
.retry:hover { background: var(--am-hover); }
/* all:initial on :host drops the UA focus ring; restore a visible one. */
.retry:focus-visible { outline: 2px solid var(--am-accent); outline-offset: 1px; }
@media (prefers-reduced-motion: reduce) {
  .pulse { animation: none; }
}
`;

/**
 * Whether the widget sits on a dark backdrop.
 *
 * Walks up from the injection point for the first element painting an opaque
 * background and measures its luminance. prefers-color-scheme is only the
 * fallback: Gmail's dark theme is a GMAIL setting, so a user on OS-light with
 * Gmail-dark (or the reverse) would otherwise get a card that fights the page.
 */
function isDarkBackdrop(start: Element | null): boolean {
  try {
    let el: Element | null = start;
    while (el) {
      const parsed = parseColor(getComputedStyle(el).backgroundColor);
      if (parsed && parsed.a > 0.1) {
        // Rec. 709 luma is plenty for a light/dark decision.
        const luma = (0.2126 * parsed.r + 0.7152 * parsed.g + 0.0722 * parsed.b) / 255;
        return luma < 0.5;
      }
      el = el.parentElement;
    }
  } catch {
    // getComputedStyle can throw on detached nodes; fall through.
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

function parseColor(value: string): { r: number; g: number; b: number; a: number } | null {
  const m = value.match(/rgba?\(([^)]+)\)/);
  if (!m?.[1]) return null;
  const parts = m[1].split(",").map((p) => parseFloat(p.trim()));
  const [r, g, b] = parts;
  if (r === undefined || g === undefined || b === undefined) return null;
  return { r, g, b, a: parts[3] ?? 1 };
}

/**
 * A mounted widget. `update` re-renders in place (no flicker on loading →
 * summary); `remove` tears the host element out of the page.
 */
export interface SummaryWidget {
  readonly host: HTMLElement;
  update(state: WidgetState): void;
  remove(): void;
}

/**
 * Create the widget and insert it before `anchor`. Returns null if the anchor is
 * detached (the SPA re-rendered between detection and injection), because
 * injecting into an orphan node silently does nothing.
 */
export function mountSummaryWidget(anchor: Element, state: WidgetState): SummaryWidget | null {
  if (!anchor.parentNode) return null;

  const host = document.createElement("div");
  host.setAttribute(HOST_ATTRIBUTE, "");
  const root = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = STYLES;
  root.append(style);

  anchor.parentNode.insertBefore(host, anchor);

  // Measured after insertion: the backdrop is the anchor's own ancestry, which
  // only has computed styles once the host is in the document.
  const dark = isDarkBackdrop(anchor);

  const widget: SummaryWidget = {
    host,
    update(next) {
      render(root, next, dark);
    },
    remove() {
      host.remove();
    },
  };
  widget.update(state);
  return widget;
}

/** Remove any widget left over from a previous thread in this document. */
export function removeExistingWidgets(): void {
  for (const el of document.querySelectorAll(`[${HOST_ATTRIBUTE}]`)) el.remove();
}

function render(root: ShadowRoot, state: WidgetState, dark = false): void {
  // Drop everything except the <style> node and rebuild — the card is four
  // elements at most, so diffing would cost more than it saves.
  for (const child of Array.from(root.children)) {
    if (child.tagName !== "STYLE") child.remove();
  }

  const card = document.createElement("div");
  const base = dark ? "card dark" : "card";
  // Announced as an aside rather than mail content, and named for Amarnai even
  // though the visible eyebrow is just "Summary" — a screen-reader user gets the
  // attribution a sighted user reads from the terracotta chrome.
  card.setAttribute("role", "note");
  card.setAttribute("aria-label", "Amarnai thread summary");
  // The card is replaced in place as the request resolves; polite live region so
  // the arriving summary is announced instead of silently swapping under focus.
  card.setAttribute("aria-live", "polite");

  if (state.kind === "loading") {
    card.className = `${base} row`;
    const pulse = document.createElement("span");
    pulse.className = "pulse";
    const label = document.createElement("span");
    label.className = "muted";
    label.textContent = STRINGS.loading;
    card.append(pulse, label);
    root.append(card);
    return;
  }

  if (state.kind === "error") {
    card.className = `${base} row`;
    const label = document.createElement("span");
    label.className = "muted body";
    label.textContent = STRINGS.error;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "retry";
    button.textContent = STRINGS.retry;
    button.addEventListener("click", state.onRetry);
    card.append(label, button);
    root.append(card);
    return;
  }

  if (state.kind === "quota") {
    card.className = `${base} row`;
    const label = document.createElement("span");
    label.className = "muted body";
    label.textContent = STRINGS.quota(formatResetDate(state.resetsAt));
    card.append(label);
    root.append(card);
    return;
  }

  card.className = base;

  const eyebrow = document.createElement("span");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = STRINGS.eyebrow;

  if (state.kind === "bullets") {
    const list = document.createElement("ul");
    list.className = "bullets body";
    for (const bullet of state.bullets) {
      const item = document.createElement("li");
      // textContent, never innerHTML — see below.
      item.textContent = bullet;
      list.append(item);
    }
    card.append(eyebrow, list);
    root.append(card);
    return;
  }

  const text = document.createElement("div");
  text.className = "text body";
  // textContent, never innerHTML: the summary is model output derived from
  // untrusted email content and is being injected into the user's mailbox.
  text.textContent = state.text;
  card.append(eyebrow, text);
  root.append(card);
}
