// The full Amarnai logomark (three wedges), as an inline SVG node.
//
// Traced from apps/site/public/logo.png (no vector source exists for it) so it
// can be drawn with document.createElementNS the same way replyIcon.ts draws
// its single wedge — inlining avoids the web_accessible_resources / OWA
// cross-origin issues documented there. Kept as its own module because this is
// the brand mark itself, not the reply button's derived, mirrored affordance.

const SVG_NS = "http://www.w3.org/2000/svg";

const VIEWBOX_WIDTH = 72;
const VIEWBOX_HEIGHT = 88;

/** The tall center wedge, then the upper and lower chevrons. */
const WEDGES = [
  "36.1,0 54,13.2 72,0 54,87.6",
  "41.3,36 0,22.8 9.9,36 0,49",
  "41.2,66.4 0,53.2 9.9,66.4 0.1,79.5",
];

export const LOGO_ATTRIBUTE = "data-aziru-logo";

/** `height` in px; width follows the mark's own aspect ratio. */
export function createLogoMark(doc: Document, height: number): SVGElement {
  const width = Math.round((height * (VIEWBOX_WIDTH / VIEWBOX_HEIGHT)) * 10) / 10;

  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute(LOGO_ATTRIBUTE, "");
  svg.setAttribute("viewBox", `0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`);
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  // Decorative: the eyebrow's own text carries the meaning.
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.style.flex = "none";

  for (const points of WEDGES) {
    const polygon = doc.createElementNS(SVG_NS, "polygon");
    polygon.setAttribute("points", points);
    polygon.setAttribute("fill", "currentColor");
    svg.appendChild(polygon);
  }
  return svg;
}
