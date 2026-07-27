import { debugLog } from "../core/debug.js";
import { REPLY_BUTTON_STRINGS } from "../core/strings.js";
import { detectGmailThread, findConversationRoot } from "./detectThread.js";
import { armReply } from "./armedReply.js";

// Chiefy-style entry points in Gmail's own reply surfaces (product decision
// 2026-07-27, superseding the earlier no-hand-rolled-reply-bar rule):
//
//   1. A pill in the bottom reply bar, beside Reply / Reply all / Forward.
//   2. An icon in the last message's header, beside the reply arrow.
//
// InboxSDK offers no supported hook for either (its message-toolbar API only
// reaches the three-dot menu), so this is hand-rolled DOM in the summaryWidget
// tradition: every selector returns null rather than guessing, a missed anchor
// means a missing button and never a broken page, and the buttons do nothing
// but arm the thread and click Gmail's OWN reply control. The compose that
// opens then auto-generates via the one state machine in replyButton.ts.
//
// Gmail selector knowledge, kept here and nowhere else:
//   - Bottom bar pills: span.ams.bkH (Reply), span.ams.bkI (Reply all),
//     span.ams.bkG (Forward), inside the .amn row. Stable for many years.
//   - Header actions row: tr.acZ, whose three-dot menu button is
//     div.T-I.J-J5-Ji.aap.L3[role=button][aria-haspopup] — lifted verbatim from
//     InboxSDK's own gmail-message-view driver, so it is a selector the SDK
//     team actively maintains. Our icon goes right before that three-dot; a
//     .aaq reply arrow is kept as fallback anchor for older DOMs.
//   - Both header and bar buttons OPEN the reply by clicking the bottom bar's
//     native Reply pill: one battle-tested click target instead of two.

export const ENTRY_ATTRIBUTE = "data-amarnai-reply-entry";

const STYLE_ATTRIBUTE = "data-amarnai-entry-styles";

/**
 * The persistent "left gap" inside the pill turned out to be no element at all:
 * `.ams::before` is Gmail's built-in icon slot, inherited with the borrowed
 * class and invisible to every DOM measurement (user-diagnosed, 2026-07-27).
 * Pseudo-elements are beyond inline styles, so a marker-scoped stylesheet kills
 * them — and provides the hover treatment Gmail gives its own controls through
 * JS-toggled classes that injected elements never receive. color-mix on
 * currentColor keeps the hover wash correct in both Gmail themes.
 */
const ENTRY_CSS = `
[${ENTRY_ATTRIBUTE}]::before,
[${ENTRY_ATTRIBUTE}]::after {
  content: none !important;
  display: none !important;
}
[${ENTRY_ATTRIBUTE}="bar"]:hover,
[${ENTRY_ATTRIBUTE}="bar"]:focus-visible {
  background-color: color-mix(in srgb, currentColor 6%, transparent);
}
[${ENTRY_ATTRIBUTE}="header"] {
  border-radius: 50%;
}
[${ENTRY_ATTRIBUTE}="header"]:hover,
[${ENTRY_ATTRIBUTE}="header"]:focus-visible {
  background-color: color-mix(in srgb, currentColor 10%, transparent);
}
`;

function ensureEntryStyles(doc: Document): void {
  if (doc.head.querySelector(`style[${STYLE_ATTRIBUTE}]`)) return;
  const style = doc.createElement("style");
  style.setAttribute(STYLE_ATTRIBUTE, "");
  style.textContent = ENTRY_CSS;
  doc.head.appendChild(style);
}

/** Bumped on every behavior change; printed in the logs so a stale build is
 * recognizable at a glance instead of masquerading as "nothing changed". */
const REV = "r8";

const OBSERVE_THROTTLE_MS = 300;

let disabled = false;

/** Reset between tests. */
export function resetReplyEntryPoints(): void {
  disabled = false;
}

/**
 * Arm the open conversation and hand off to Gmail's own control. The native
 * click is what opens the compose, so Gmail's behavior (quoting, recipients,
 * focus) is exactly what the user would have gotten by hand.
 */
function activate(nativeReplyControl: HTMLElement, doc: Document): void {
  const context = detectGmailThread(doc);
  if (context) armReply(context.providerThreadId);
  else debugLog("reply entry: could not read thread id — opening reply unarmed");
  nativeReplyControl.click();
}

function makeAccessible(el: HTMLElement, onActivate: () => void): void {
  el.setAttribute("role", "button");
  el.setAttribute("tabindex", "0");
  el.setAttribute("aria-label", REPLY_BUTTON_STRINGS.entryTooltip);
  // Gmail's global hover delegation renders a native-styled tooltip for any
  // element carrying data-tooltip, injected ones included. No `title` alongside
  // it: the browser tooltip would double up with Gmail's.
  el.setAttribute("data-tooltip", REPLY_BUTTON_STRINGS.entryTooltip);
  el.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onActivate();
  });
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onActivate();
    }
  });
}

function makeIcon(doc: Document, size: number): HTMLElement {
  const icon = doc.createElement("img");
  icon.src = chrome.runtime.getURL("reply-button-icon.svg");
  icon.alt = "";
  icon.style.width = `${size}px`;
  icon.style.height = `${size}px`;
  icon.style.verticalAlign = "middle";
  icon.style.flex = "none";
  return icon;
}

/** The bottom bar's native Reply pill — the one click target both buttons use. */
function findNativeReply(root: Element): HTMLElement | null {
  return root.querySelector<HTMLElement>("span.ams.bkH");
}

/**
 * The bottom-bar pill. Styled by borrowing the native Reply pill's classes
 * (minus its action-specific ones) so it reads as one of Gmail's own; margins
 * are copied from the native pill's computed style because the class-inherited
 * ones double up against the neighbour's and open a visible gap.
 */
function injectBarButton(root: Element, doc: Document): void {
  if (root.querySelector(`[${ENTRY_ATTRIBUTE}="bar"]`)) return;

  const nativeReply = findNativeReply(root);
  if (!nativeReply?.parentElement) {
    debugLog("reply entry: bottom reply bar not found (span.ams.bkH)");
    return;
  }
  const replyAll = root.querySelector<HTMLElement>("span.ams.bkI");
  const anchor = replyAll ?? nativeReply;

  const pill = doc.createElement("span");
  // bkH is the Reply-specific hook; everything else is shared pill styling.
  pill.className = nativeReply.className.replace(/\bbkH\b/g, "").trim();
  pill.setAttribute(ENTRY_ATTRIBUTE, "bar");
  pill.style.display = "inline-flex";
  pill.style.alignItems = "center";
  pill.style.gap = "8px";
  pill.style.cursor = "pointer";
  pill.style.marginLeft = "0px";
  // The rendered padding belongs partly to the action-specific class stripped
  // above (live 2026-07-27: edge gaps measured identical while the pill still
  // LOOKED wider — the extra space was inside). Copy the native pill's computed
  // box so removing bkH cannot change the inside spacing.
  const nativeBox = doc.defaultView?.getComputedStyle(nativeReply);
  for (const prop of ["paddingLeft", "paddingRight", "paddingTop", "paddingBottom", "minWidth", "height", "lineHeight"] as const) {
    const value = nativeBox?.[prop];
    if (value) pill.style[prop] = value;
  }
  pill.appendChild(makeIcon(doc, 20));
  pill.appendChild(doc.createTextNode(REPLY_BUTTON_STRINGS.idle));
  makeAccessible(pill, () => activate(nativeReply, doc));

  anchor.insertAdjacentElement("afterend", pill);
  recalibrateBarPill(root, doc);
  debugLog(
    `reply entry: bottom-bar button injected (${REV}) —`,
    `pad=${pill.style.paddingLeft || "?"}/${pill.style.paddingRight || "?"}`,
  );
  // One structural dump of the whole bar row: names, widths, hidden markers.
  // This is the line that identifies "the invisible element" — whatever sits in
  // the row that should not, from Gmail or another extension, shows up here.
  const rowChildren = Array.from(pill.parentElement?.children ?? []) as HTMLElement[];
  debugLog(
    `reply entry: bar layout (${REV}) —`,
    rowChildren
      .map((el) => {
        const name =
          el === pill
            ? "AMARNAI"
            : `${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0] || "?"}`;
        const width = el.getBoundingClientRect().width;
        return `${name}(${width.toFixed(0)}w${isRendered(el) ? "" : ",hidden"})`;
      })
      .join(" "),
  );
}

/** The smallest positive rendered gap between two adjacent native pills. */
function measureNativeGap(root: Element): number | null {
  const pills = ["span.ams.bkH", "span.ams.bkI", "span.ams.bkG"]
    .map((sel) => root.querySelector<HTMLElement>(sel))
    .filter((el): el is HTMLElement => el !== null && isRendered(el));
  let best: number | null = null;
  for (let i = 0; i < pills.length - 1; i += 1) {
    const gap = pills[i + 1]!.getBoundingClientRect().left - pills[i]!.getBoundingClientRect().right;
    if (Number.isFinite(gap) && gap > 0 && (best === null || gap < best)) best = gap;
  }
  return best;
}

/** Visibly rendered: takes layout space AND is actually painted. */
function isRendered(el: HTMLElement): boolean {
  if (el.getBoundingClientRect().width <= 0) return false;
  const style = el.ownerDocument.defaultView?.getComputedStyle(el);
  if (!style) return true;
  return style.visibility === "visible" && style.display !== "none" && style.opacity !== "0";
}

/**
 * Keep the pill's LEFT gap equal to the native pills' own spacing — measured
 * against the nearest sibling that is actually painted, on every tick.
 *
 * Why this is not a one-shot at injection: the bar turned out to contain
 * invisible elements that still consume layout width (found by inspection,
 * 2026-07-27 — origin unknown, possibly Gmail placeholders or another
 * extension), and Gmail may reflow the bar after we inject. Edge-adjacent
 * calibration measured a perfect gap while the painted gap was wider. Bridging
 * an invisible spacer legitimately needs a negative margin; clamped so a
 * mismeasure can never drag the pill far.
 */
function recalibrateBarPill(root: Element, doc: Document): void {
  const pill = root.querySelector<HTMLElement>(`[${ENTRY_ATTRIBUTE}="bar"]`);
  if (!pill) return;
  const nativeGap = measureNativeGap(root);
  if (nativeGap === null) return;

  const skipped: string[] = [];
  let prev = pill.previousElementSibling as HTMLElement | null;
  while (prev && !isRendered(prev)) {
    const width = prev.getBoundingClientRect().width;
    skipped.push(`${prev.tagName.toLowerCase()}.${String(prev.className).split(" ")[0] || "?"}(${width.toFixed(0)}w)`);
    prev = prev.previousElementSibling as HTMLElement | null;
  }
  if (!prev) return;

  const gap = pill.getBoundingClientRect().left - prev.getBoundingClientRect().right;
  const delta = nativeGap - gap;
  if (!Number.isFinite(delta) || Math.abs(delta) <= 0.5) return;

  const currentMargin = Number.parseFloat(pill.style.marginLeft || "0") || 0;
  const next = Math.max(-48, Math.min(48, Math.round(currentMargin + delta)));
  pill.style.marginLeft = `${next}px`;
  debugLog(
    `reply entry: bar gap recalibrated (${REV}) —`,
    `nativeGap=${nativeGap.toFixed(1)}`,
    `paintedGap=${gap.toFixed(1)}`,
    `marginLeft=${next}px`,
    skipped.length > 0 ? `bridged=[${skipped.join(", ")}]` : "bridged=none",
  );
  void doc;
}

const MESSAGE_MARKER = "[data-legacy-message-id], [data-message-id]";

/**
 * Where the header icon goes: before some menu button in the last message's
 * action cluster. Three rungs, best knowledge first:
 *   1. InboxSDK's maintained selector for the three-dot (tr.acZ table layout).
 *   2. The legacy .aaq reply-arrow class.
 *   3. Structural and class-free: the first [role=button][aria-haspopup=true]
 *      inside the last message element. Menu buttons are the only haspopup
 *      buttons in a message header, the header precedes the body in DOM order,
 *      and neither role nor aria-haspopup is localized or minified — this rung
 *      survives Gmail class churn (live 2026-07-27: rungs 1 and 2 both missed).
 */
function findHeaderAnchor(
  root: Element,
): { anchor: HTMLElement; borrowClasses: boolean } | null {
  const rows = root.querySelectorAll<HTMLElement>("tr.acZ");
  const row = rows.length > 0 ? rows[rows.length - 1]! : null;
  const sdkMore = row?.querySelector<HTMLElement>(
    "div.T-I.J-J5-Ji.aap.L3[role=button][aria-haspopup]",
  );
  if (sdkMore) return { anchor: sdkMore, borrowClasses: true };

  const arrows = root.querySelectorAll<HTMLElement>(".aaq");
  if (arrows.length > 0) return { anchor: arrows[arrows.length - 1]!, borrowClasses: true };

  const messages = root.querySelectorAll<HTMLElement>(MESSAGE_MARKER);
  const lastMessage = messages.length > 0 ? messages[messages.length - 1]! : null;
  if (!lastMessage) return null;

  // The target is the header's action cluster: star, emoji, reply arrow,
  // three-dot, rendered as a run of sibling buttons. Two structural facts are
  // load-bearing (live lessons, 2026-07-27):
  //   - aria-haspopup's value varies ("true", "menu", …), and the recipient
  //     line's "show details" chevron is ALSO a popup button — so popup-ness
  //     alone selects the wrong element and value-matching misses the right
  //     one. What distinguishes the cluster is company: several buttons under
  //     one nearby ancestor. The chevron sits alone.
  const BUTTONISH = '[role="button"], button';
  const isPopup = (el: Element): boolean => {
    const v = el.getAttribute("aria-haspopup");
    return v !== null && v !== "false";
  };
  const clusterOf = (el: HTMLElement): HTMLElement | null => {
    let scope: HTMLElement | null = el.parentElement;
    for (let depth = 0; depth < 3 && scope; depth += 1, scope = scope.parentElement) {
      if (scope.querySelectorAll(BUTTONISH).length >= 3) return scope;
    }
    return null;
  };

  const allButtons = Array.from(lastMessage.querySelectorAll<HTMLElement>(BUTTONISH));

  // Best: a popup button inside a cluster — the three-dot itself.
  let generic = [...allButtons].reverse().find((b) => isPopup(b) && clusterOf(b)) ?? null;

  // Next: the cluster found directly (its menu button may declare no popup at
  // all); anchor before its last button, which is where the three-dot lives.
  // Scanned from the START: the header precedes the body, and email bodies are
  // untrusted content that may contain button-shaped markup of its own.
  if (!generic) {
    const firstClustered = allButtons.find((b) => clusterOf(b));
    const cluster = firstClustered ? clusterOf(firstClustered) : null;
    if (cluster) {
      const inCluster = cluster.querySelectorAll<HTMLElement>(BUTTONISH);
      generic = inCluster[inCluster.length - 1] ?? null;
    }
  }

  // Last resort: any popup button at all beats no icon.
  if (!generic) generic = [...allButtons].reverse().find(isPopup) ?? null;

  debugLog(
    "reply entry: structural header scan —",
    `buttons=${allButtons.length}`,
    `popups=${allButtons.filter(isPopup).length}`,
    `anchored=${generic ? "yes" : "no"}`,
  );
  // Unknown classes may paint the anchor's own glyph (the three dots) via CSS;
  // borrowing them would draw that glyph under our icon. Style inline instead.
  return generic ? { anchor: generic, borrowClasses: false } : null;
}

/**
 * The header icon, in the last message's action cluster. Clicking it clicks the
 * bottom bar's native Reply — the same compose the header's own arrow would
 * open — so the icon works without ever identifying that arrow.
 */
function injectHeaderButton(root: Element, doc: Document): void {
  if (root.querySelector(`[${ENTRY_ATTRIBUTE}="header"]`)) return;

  const nativeReply = findNativeReply(root);
  if (!nativeReply) return; // nothing to open a reply with — bar log covers it

  const found = findHeaderAnchor(root);
  if (!found?.anchor.parentElement) {
    debugLog(
      "reply entry: header anchor not found —",
      `acZ rows=${root.querySelectorAll("tr.acZ").length}`,
      `aaq=${root.querySelectorAll(".aaq").length}`,
      `messages=${root.querySelectorAll(MESSAGE_MARKER).length}`,
      `haspopup buttons=${root.querySelectorAll('[role="button"][aria-haspopup="true"]').length}`,
    );
    return;
  }

  const { anchor, borrowClasses } = found;
  const button = doc.createElement("div");
  if (borrowClasses) {
    // Borrow the anchor's hover-circle styling minus its action-specific class.
    button.className = anchor.className.replace(/\b(aap|aaq)\b/g, "").trim();
  } else {
    // Hit target sized like Gmail's own icon buttons (~40px circle around a
    // 20px glyph); the circle and hover wash come from ENTRY_CSS.
    button.style.padding = "8px";
  }
  button.setAttribute(ENTRY_ATTRIBUTE, "header");
  button.style.display = "inline-flex";
  button.style.alignItems = "center";
  button.style.justifyContent = "center";
  button.style.cursor = "pointer";
  button.appendChild(makeIcon(doc, 20));
  makeAccessible(button, () => activate(nativeReply, doc));

  anchor.insertAdjacentElement("beforebegin", button);
  debugLog(
    `reply entry: header button injected (${REV})`,
    borrowClasses ? "(class-anchored)" : "(structural anchor)",
  );
}

/**
 * Idempotent: marker attributes make re-runs cheap, so this can be called on
 * every DOM tick. Gmail removes the bottom bar while a compose is open and
 * re-renders it after a discard; the observer brings the button back.
 */
export function ensureReplyEntryPoints(doc: Document = document): void {
  if (disabled) return;
  const root = findConversationRoot(doc);
  if (!root) return;
  ensureEntryStyles(doc);
  injectBarButton(root, doc);
  injectHeaderButton(root, doc);
  recalibrateBarPill(root, doc);
}

/**
 * The workspace turned the reply button off (the compose button got
 * injectionDisabled). Remove what is injected and stop injecting: a button that
 * can only lead to a refusal should not exist.
 */
export function disableReplyEntryPoints(doc: Document = document): void {
  disabled = true;
  for (const el of Array.from(doc.querySelectorAll(`[${ENTRY_ATTRIBUTE}]`))) el.remove();
  debugLog("reply entry: disabled for this workspace — entry points removed");
}

/**
 * Watch for conversation renders, throttled like the summary scheduler: Gmail
 * mutates constantly, and a trailing-edge timer batches bursts into one check.
 */
export function startReplyEntryPoints(doc: Document = document): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    if (timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      ensureReplyEntryPoints(doc);
    }, OBSERVE_THROTTLE_MS);
  };

  const observer = new MutationObserver(schedule);
  observer.observe(doc.body, { childList: true, subtree: true });
  const onNav = () => schedule();
  doc.defaultView?.addEventListener("hashchange", onNav);
  doc.defaultView?.addEventListener("popstate", onNav);

  ensureReplyEntryPoints(doc);

  return () => {
    observer.disconnect();
    doc.defaultView?.removeEventListener("hashchange", onNav);
    doc.defaultView?.removeEventListener("popstate", onNav);
    clearTimeout(timer);
  };
}
