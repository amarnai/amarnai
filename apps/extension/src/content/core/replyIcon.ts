// The Amarnai Reply mark, as an inline SVG node.
//
// Inline rather than <img src=chrome-extension://…>: an extension URL loaded by
// the mail page needs a web_accessible_resources grant, and OWA rejected it
// outright ("Denying load of chrome-extension://…", live 2026-07-28). Inlining
// removes that dependency entirely — no WAR, no cross-origin fetch, nothing to
// keep in sync per host — and lets the geometry honor `currentColor` the way the
// canonical mark was designed to.
//
// GEOMETRY IS DUPLICATED, deliberately and narrowly: public/reply-button-icon.svg
// carries the same polygon for InboxSDK's compose button, whose `iconUrl` API
// takes a URL and cannot accept a node. Keep the two in step; the file is the
// canonical drawing and this is its inline twin.

const SVG_NS = "http://www.w3.org/2000/svg";

/** Left-pointing wedge from the Amarnai logo (aspect ~1.58:1, barb notch ~24%). */
const POINTS = "2,12 22,5.7 17.1,12 22,18.3";

/** Marks the icon so the stylesheets below can color it. */
export const ICON_ATTRIBUTE = "data-aziru-reply-icon";

export function createReplyIcon(doc: Document, size: number): SVGElement {
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute(ICON_ATTRIBUTE, "");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  // Decorative: the button's own label and aria-label carry the meaning.
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.style.flex = "none";

  const polygon = doc.createElementNS(SVG_NS, "polygon");
  polygon.setAttribute("points", POINTS);
  polygon.setAttribute("fill", "currentColor");
  svg.appendChild(polygon);
  return svg;
}

/**
 * Clay in both schemes. A stylesheet rather than an inline style because
 * prefers-color-scheme cannot be expressed inline; shared by the Gmail and OWA
 * injectors so the mark is one color everywhere.
 */
export const REPLY_ICON_CSS = `
[${ICON_ATTRIBUTE}] { color: #BB5B33; }
@media (prefers-color-scheme: dark) {
  [${ICON_ATTRIBUTE}] { color: #CD6A3F; }
}
`;
