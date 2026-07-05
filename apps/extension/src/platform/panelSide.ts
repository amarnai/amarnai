// Which screen edge the extension panel is docked to.
//
// Chrome's side panel is always on the right; Firefox's sidebar defaults to the
// left but the user can move it to either side, and there is no extension API
// that reports the position. So we infer it geometrically from where the panel's
// own viewport sits on the screen: a panel whose horizontal centre falls in the
// left half of the screen is left-docked, otherwise right-docked.
//
// This lets pop-ups (e.g. the notification bell) open toward screen centre
// instead of off the near edge, on both browsers, without special-casing either.
export type PanelSide = "left" | "right";

export function detectPanelSide(win: Window = window): PanelSide {
  const { screen } = win;
  // `availLeft` is the x-origin of the current monitor on the virtual desktop;
  // subtracting it makes `relX` relative to this monitor (0 on the primary). It
  // is non-standard (absent from the DOM `Screen` type) but supported on both
  // Chrome and Firefox, so read it defensively.
  const availLeft = (screen as Screen & { availLeft?: number }).availLeft ?? 0;
  const relX = win.screenX - availLeft;
  const panelCentre = relX + win.innerWidth / 2;
  return panelCentre < screen.availWidth / 2 ? "left" : "right";
}
