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
  | { kind: "error"; onRetry: () => void }
  | { kind: "quota"; resetsAt: string };

const HOST_ATTRIBUTE = "data-amarnai-summary";

// Amarnai brand tokens, inlined because the mail page has none of our CSS vars.
// Light values are packages/tokens colors.ts verbatim; dark values are the
// html[data-theme="dark"] oklch tokens converted to sRGB. Keep both in step with
// the token package — this is the one place the palette is duplicated, and it is
// duplicated because a third-party page cannot import it.
const LIGHT = {
  surface: "#fdfcfa", // --surface-2
  line: "#ece9e4", // --line
  text: "#4d4843", // --ink-2
  muted: "#706c66", // --ink-3
  accent: "#c2683f", // --accent
  accentInk: "#7b3a1d", // --accent-ink
  hover: "#f3f0ea", // --bg-sunk
};
const DARK = {
  surface: "#1e1d1a",
  line: "#262421",
  text: "#bab7b2",
  muted: "#8f8c87",
  accent: "#c65d36",
  accentInk: "#e6af9c",
  hover: "#35322f",
};

function paletteVars(p: typeof LIGHT): string {
  return `
    --am-surface: ${p.surface};
    --am-line: ${p.line};
    --am-text: ${p.text};
    --am-muted: ${p.muted};
    --am-accent: ${p.accent};
    --am-accent-ink: ${p.accentInk};
    --am-hover: ${p.hover};`;
}

// Design intent: unmistakably Amarnai (terracotta rail, mono eyebrow, warm
// surface) while sitting quietly inside Gmail. Deliberately NOT a filled slab —
// the previous version dominated the conversation it was annotating. The body
// text inherits the mail app's own font stack (page @font-face rules reach into
// shadow roots), so the summary reads as part of the client rather than pasted in;
// only the eyebrow uses our mono voice.
const STYLES = `
:host { all: initial; display: block; }
.card {
  ${paletteVars(LIGHT)}
  font-family: "Google Sans", Roboto, system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: 13px;
  line-height: 1.55;
  margin: 6px 0px 0px 12px;
  padding: 9px 13px 9px 12px;
  border: 1px solid var(--am-line);
  border-left: 3px solid var(--am-accent);
  border-radius: 10px;
  background: var(--am-surface);
  color: var(--am-text);
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.card.dark { ${paletteVars(DARK)} }
.body { flex: 1 1 auto; min-width: 0; }
.eyebrow {
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  font-size: 9.5px;
  font-weight: 500;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--am-accent-ink);
  flex: 0 0 auto;
}
.text { overflow-wrap: anywhere; }
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
  border: 1px solid var(--am-line);
  border-radius: 6px;
  background: transparent;
  color: var(--am-accent-ink);
  padding: 2px 9px;
  flex: 0 0 auto;
}
.retry:hover { background: var(--am-hover); }
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
  card.className = dark ? "card dark" : "card";

  if (state.kind === "loading") {
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
    const label = document.createElement("span");
    label.className = "muted body";
    label.textContent = STRINGS.quota(formatResetDate(state.resetsAt));
    card.append(label);
    root.append(card);
    return;
  }

  // Eyebrow and text sit on one baseline-aligned row rather than stacked: one
  // line shorter, which keeps the card from pushing the actual conversation down.
  const eyebrow = document.createElement("span");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = STRINGS.eyebrow;
  const text = document.createElement("div");
  text.className = "text body";
  // textContent, never innerHTML: the summary is model output derived from
  // untrusted email content and is being injected into the user's mailbox.
  text.textContent = state.text;
  card.append(eyebrow, text);
  root.append(card);
}
