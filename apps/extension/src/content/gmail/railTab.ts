import { createLogoMark } from "../core/logoMark.js";
import { EDGE_TAB_CSS } from "../core/edgeTabStyles.js";
import { PANEL_TAB_STRINGS } from "../core/strings.js";

// A big clay tab pinned to Gmail's right edge that opens the Aziru sidebar —
// the OWA drawer's tab, transplanted. It exists because the rail slot InboxSDK
// gives us cannot be made bigger: the slot has fixed bounds and a circular
// hover mask, so anything past ~20px is cropped, and a ~20px icon in a rail
// most users have never opened was being missed outright.
//
// The tab is pure entry point: clicking it opens Gmail's own sidebar (where the
// panel already lives), and the host hides it while the panel is active. The
// InboxSDK rail icon stays too — Gmail treats it as the panel's identity in the
// rail, and it costs nothing.

const HOST_ATTRIBUTE = "data-aziru-gmail-rail-tab";

/**
 * How far down the right edge the tab sits. Gmail's companion rail clusters its
 * icons (Calendar, Keep, Tasks, add-ons) at the top and keeps a chevron at the
 * bottom; this lands in the empty stretch between. The number QA tunes.
 */
const TAB_TOP = "55%";

/**
 * Above Gmail's ordinary chrome, below its dialogs (backdrops run ~6000): a
 * modal should paint over an entry-point tab, not under it.
 */
const Z_INDEX = 1000;

const STYLES = `
:host {
  all: initial;
  position: fixed;
  top: ${TAB_TOP};
  right: 0;
  z-index: ${Z_INDEX};
}
:host([data-hidden]) { display: none; }
${EDGE_TAB_CSS}
.tab {
  width: 52px;
  height: 64px;
}
`;

export interface RailTab {
  /** Hidden while the sidebar panel is active — the tab only opens, never closes. */
  setHidden(hidden: boolean): void;
  remove(): void;
}

export function mountRailTab(doc: Document, onOpen: () => void): RailTab {
  const host = doc.createElement("div");
  host.setAttribute(HOST_ATTRIBUTE, "");
  // A shadow root, like every injected surface: a real button with focus and
  // hover states that Gmail's global styles must not reach.
  const root = host.attachShadow({ mode: "open" });
  const style = doc.createElement("style");
  style.textContent = STYLES;

  const button = doc.createElement("button");
  button.type = "button";
  button.className = "tab";
  button.setAttribute("aria-label", PANEL_TAB_STRINGS.open);
  button.title = PANEL_TAB_STRINGS.title;
  button.append(createLogoMark(doc, 30));
  button.addEventListener("click", onOpen);

  root.append(style, button);
  // The body and nowhere else: position:fixed resolves against any ancestor
  // carrying a transform, exactly as documented for the OWA drawer.
  doc.body.append(host);

  return {
    setHidden(hidden: boolean): void {
      host.toggleAttribute("data-hidden", hidden);
    },
    remove(): void {
      host.remove();
    },
  };
}
