/**
 * Static files served from the extension's own bundle. Kept apart from the
 * components that use them so a lazily-loaded overlay's constants can be read
 * without pulling that overlay (and its chunk) into the main panel bundle.
 */

/** The Aziru upgrade artwork. The web app serves its own copy from /public. */
export const MASCOT_SRC = "/aziru-upgrade.png";
