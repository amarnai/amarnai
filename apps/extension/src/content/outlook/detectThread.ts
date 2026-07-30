import type { ThreadContext } from "../core/scheduler.js";
import { extractEmail } from "../gmail/detectThread.js";

// OWA DOM knowledge lives here and nowhere else.
//
// Load testing (2026-07-27) confirmed `data-convid` is present but carries the
// EWS flavor of the conversation id (`+`, `/`) rather than the Graph flavor we
// store as providerThreadId (Graph swaps `+`→`_`, `/`→`-`; NOT standard
// base64url). Per the original plan, normalization lives in the
// provider-threads summary route (one place, both callers), not here — this
// file forwards the attribute value verbatim.
// Remaining safety properties:
//   1. Every path returns null rather than guessing, so a wrong selector shows
//      no widget instead of a wrong one.
//   2. A value that does not match a stored thread 404s server-side and the
//      content script renders nothing.

const CONVERSATION_ID_ATTRIBUTES = ["data-convid", "data-conversation-id"];

export function findConversationId(doc: Document = document): string | null {
  for (const attribute of CONVERSATION_ID_ATTRIBUTES) {
    // OWA's three-pane layout keeps the message LIST visible beside the reading
    // pane, and every list row carries data-convid — so a first-match query is
    // routinely some other conversation (the Gmail flavor of this bug shipped a
    // correct summary of the wrong thread). The open conversation is the
    // SELECTED row; trust that first.
    const selected = doc.querySelector(`[${attribute}][aria-selected='true']`);
    const selectedValue = selected?.getAttribute(attribute)?.trim();
    if (selectedValue) return selectedValue;

    // No selection marker: only trust the document when it is unambiguous —
    // every carrier of the attribute names the same conversation. Ambiguity
    // means we cannot know which one is open, and a wrong summary is strictly
    // worse than none.
    const values = new Set(
      Array.from(doc.querySelectorAll(`[${attribute}]`))
        .map((el) => el.getAttribute(attribute)?.trim())
        .filter((v): v is string => !!v),
    );
    if (values.size === 1) return [...values][0]!;
    if (values.size > 1) return null;
  }
  return null;
}

/**
 * The mailbox currently shown in OWA. As on Gmail, no address means no widget:
 * summarizing the wrong mailbox is worse than summarizing nothing.
 */
export function findAccountEmail(doc: Document = document): string | null {
  const candidates = [
    doc.querySelector("#O365_MainLink_Me")?.getAttribute("aria-label"),
    doc.querySelector("[id*='meControl'] [aria-label*='@']")?.getAttribute("aria-label"),
    doc.querySelector("button[aria-label*='@']")?.getAttribute("aria-label"),
    doc.querySelector("[data-log-name='MeControl']")?.textContent,
  ];
  for (const candidate of candidates) {
    const email = extractEmail(candidate);
    if (email) return email;
  }

  // Consumer OWA (outlook.live.com) puts no address anywhere in the header —
  // the only one in the chrome is the account's root node in the folder pane
  // (load-tested 2026-07-27). Same ambiguity rule as findConversationId: with
  // several signed-in accounts the tree names all of them and we cannot know
  // which mailbox is displayed, so only a single distinct address is trusted.
  const emails = new Set<string>();
  for (const item of Array.from(doc.querySelectorAll("[role='tree'] [role='treeitem']"))) {
    const email =
      extractEmail(item.getAttribute("title")) ??
      extractEmail(item.getAttribute("aria-label")) ??
      extractEmail(item.textContent);
    if (email) emails.add(email);
  }
  if (emails.size === 1) return [...emails][0]!;
  return null;
}

/**
 * OWA's standalone deeplink read view, and the message it is showing.
 *
 * This is a fourth OWA layout and it agrees with the other three about almost
 * nothing (DOM mapped on a live mailbox, 2026-07-30): no `[role='main']`, no
 * `#ConversationReadingPaneContainer`, no account header, no folder tree, and no
 * `data-convid` anywhere — because it is an ITEM view, showing one message rather
 * than a conversation. It is where Microsoft's own `webLink` lands, so Amarnai
 * sends users here itself from the queue; `ispopout=0` does not prevent it on
 * consumer OWA.
 *
 * The id therefore comes from the URL rather than the DOM, which is the sturdier
 * source anyway: `/mail/deeplink/read/<id>` is OWA's own routing contract, while
 * every DOM anchor here is a build-hashed class. Both halves of the URL carry the
 * same value in different alphabets — the path segment URL-safe, the `ItemID`
 * query param the EWS flavor — so either resolves once normalized server-side.
 * The path segment is preferred simply because it is the canonical one.
 *
 * Returns null off this route, which is what keeps the other three layouts on the
 * conversation-id path they already use.
 */
const DEEPLINK_READ_PATH = /^\/mail\/(?:\d+\/)?deeplink\/read\/([^/?#]+)/;

export function findDeeplinkMessageId(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const fromPath = DEEPLINK_READ_PATH.exec(parsed.pathname)?.[1];
  if (fromPath) return decodeURIComponent(fromPath);
  // Only if the path form ever changes shape: the same value, EWS-flavored.
  return parsed.searchParams.get("ItemID");
}

/**
 * Whether this document is the deeplink read view. Anchored on the URL and on
 * OWA's own `#ItemReadingPaneContainer` id, not on the absence of the other
 * layouts' anchors: "no reading pane found" is also what a half-rendered
 * three-pane page looks like, and treating that as this layout would resolve a
 * conversation as a message id.
 */
export function isDeeplinkReadView(doc: Document = document): boolean {
  return (
    !!findDeeplinkMessageId(doc.location?.href ?? "") &&
    !!doc.getElementById("ItemReadingPaneContainer")
  );
}

export function detectOutlookThread(doc: Document = document): ThreadContext | null {
  // The deeplink read view first, and before the [role='main'] gate below —
  // because it has no [role='main'] at all, which is exactly why every injected
  // surface used to give up on it. Its id is the open MESSAGE's, taken from the
  // route, and it says so.
  const deeplinkMessageId = isDeeplinkReadView(doc)
    ? findDeeplinkMessageId(doc.location?.href ?? "")
    : null;
  if (deeplinkMessageId) {
    // accountEmail stays whatever the page can say, which on this layout is
    // nothing: its only addresses are in the message body (To:, mailto:) and are
    // recipients, not the mailbox reading it. The background settles it against
    // the connected mailboxes instead.
    return {
      providerThreadId: deeplinkMessageId,
      accountEmail: findAccountEmail(doc),
      refKind: "message",
    };
  }

  // Presence of the reading pane is what distinguishes "a thread is open" from
  // "a row is selected in the list" — OWA keeps the list mounted either way.
  if (!doc.querySelector("[role='main']")) return null;
  const providerThreadId = findConversationId(doc);
  if (!providerThreadId) return null;
  return { providerThreadId, accountEmail: findAccountEmail(doc), refKind: "thread" };
}

/**
 * Whether OWA is actually SHOWING a conversation, as opposed to merely having a
 * row selected in the list beside an empty reading pane.
 *
 * `findConversationId` cannot answer this and must not try: it prefers the
 * `aria-selected` row, and OWA leaves a row selected when the reading pane is
 * empty — open the mailbox fresh and there is a highlighted row next to the
 * "take Outlook with you" promo. The summary card wants exactly that behaviour,
 * because it anchors to the list row. The injected panel does not: it would show
 * a thread screen for a thread nobody opened, and offer to insert a draft into a
 * reply form that is not on the page.
 *
 * `#ConversationReadingPaneContainer` is OWA's own id for the pane that renders
 * a conversation, and it is the same anchor the Amarnai Reply pill already
 * depends on across all three OWA hosts — so this adds no new DOM bet, it reuses
 * the one already shipping. If some build renders a conversation without it the
 * panel falls back to the queue, which is the failure direction to want: showing
 * the queue while a conversation is open costs the user a click, while claiming a
 * conversation that is not there breaks the draft affordance outright.
 */
export function isConversationOpen(doc: Document = document): boolean {
  // `#ItemReadingPaneContainer` is the deeplink read view's equivalent, and it is
  // OWA's own id for the pane rendering the open item — the same kind of anchor,
  // for a layout that has no conversation pane because it shows one message.
  return (
    !!doc.getElementById("ConversationReadingPaneContainer") ||
    !!doc.getElementById("ItemReadingPaneContainer")
  );
}

/**
 * Which conversation the injected panel is looking at, and by which kind of id.
 * Null when OWA is showing no conversation at all.
 *
 * The panel's one answer to that question, used both by the reader that reports
 * context to the frame and by the insertion path that arms OWA's reply. They had
 * drifted: the reader knew about the deeplink read view and the insertion path
 * did not, so on that layout the panel offered a draft it could never place —
 * `isConversationOpen` says yes there (the item pane), while
 * `findConversationId` says nothing (an item view carries no `data-convid`).
 *
 * Deliberately NOT shared with `detectOutlookThread`, which the summary card
 * uses: that one wants the `aria-selected` list row even with an empty reading
 * pane, and this one must not. See `isConversationOpen` for why those two
 * requirements are genuinely opposed.
 */
export function readOpenThreadRef(
  doc: Document = document,
): { providerThreadId: string; refKind: "thread" | "message" } | null {
  // The deeplink read view is asked first, because it can answer where the
  // conversation reader cannot: its id comes from the URL and travels as a
  // message ref for the server to resolve through providerMessageId.
  const deeplinkMessageId = isDeeplinkReadView(doc)
    ? findDeeplinkMessageId(doc.location?.href ?? "")
    : null;
  if (deeplinkMessageId) {
    return { providerThreadId: deeplinkMessageId, refKind: "message" };
  }
  if (!isConversationOpen(doc)) return null;
  const providerThreadId = findConversationId(doc);
  return providerThreadId ? { providerThreadId, refKind: "thread" } : null;
}

/** Insert the card above the reading pane's message list. */
export function findOutlookInjectionAnchor(doc: Document = document): Element | null {
  const main = doc.querySelector("[role='main']");
  if (!main) return null;
  const list = main.querySelector("div[role='list']") ?? main.querySelector("[role='listbox']");
  if (list) return list;

  // Consumer OWA (outlook.live.com) renders the conversation without list
  // roles. DOM mapped on a live mailbox (2026-07-27):
  // #ConversationReadingPaneContainer holds the subject header stack and the
  // messages block, and the header FLOATS over the container's top — the
  // messages block clears it with its own spacing, so anything inserted above
  // that block renders underneath the header, clipped. The in-flow spot is
  // inside the messages block's scroll region (`customScrollBar`, a semantic
  // class OWA keeps across builds, unlike the hashed ones): before its first
  // child, i.e. directly above the first message.
  //
  // This is the ONLY anchor, with no coarser fallback, because the scheduler
  // latches on the first successful mount. Two traps a fallback walks into,
  // both observed on a live mailbox:
  //   - `.customScrollBar` also matches the OUTER #ReadingPaneContainerId, so
  //     a document-wide lookup silently mounts at the top of the whole pane,
  //     behind the header.
  //   - On a cold load (refresh / deep link) #ConversationReadingPaneContainer
  //     does not exist yet, so ANY fallback fires during that window and pins
  //     the card in the wrong place for the life of the page.
  // Returning null keeps the scheduler retrying until the real anchor exists,
  // which is why MAX_ATTEMPTS_PER_THREAD must cover a cold conversation load.
  const conversation = doc.getElementById("ConversationReadingPaneContainer");
  return conversation?.querySelector(".customScrollBar")?.firstElementChild ?? null;
}
