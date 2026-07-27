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

export function detectOutlookThread(doc: Document = document): ThreadContext | null {
  // Presence of the reading pane is what distinguishes "a thread is open" from
  // "a row is selected in the list" — OWA keeps the list mounted either way.
  if (!doc.querySelector("[role='main']")) return null;
  const providerThreadId = findConversationId(doc);
  if (!providerThreadId) return null;
  return { providerThreadId, accountEmail: findAccountEmail(doc) };
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
