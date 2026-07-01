import { STORAGE_KEY, THEMES, DEFAULT_THEME_ID } from "./themes.js";

const LIGHT_ID =
  THEMES.find((t) => t.systemRole === "light")?.id ?? DEFAULT_THEME_ID;
const DARK_ID =
  THEMES.find((t) => t.systemRole === "dark")?.id ?? DEFAULT_THEME_ID;
const VALID_IDS = THEMES.map((t) => t.id);

/**
 * Blocking IIFE injected into <head>/top of <body> so `data-theme` is set on
 * <html> before first paint — this is what prevents a light flash. It is fully
 * self-contained (no imports at runtime); the registry-derived ids are baked
 * in at build time so it stays in sync with THEMES.
 */
export const THEME_INIT_SCRIPT = `(function(){try{` +
  `var k=${JSON.stringify(STORAGE_KEY)},ids=${JSON.stringify(VALID_IDS)};` +
  `var s=localStorage.getItem(k),id;` +
  `if(s&&s!=="system"&&ids.indexOf(s)!==-1){id=s;}` +
  `else{id=matchMedia("(prefers-color-scheme: dark)").matches?${JSON.stringify(DARK_ID)}:${JSON.stringify(LIGHT_ID)};}` +
  `document.documentElement.dataset.theme=id;` +
  `}catch(e){}})();`;
