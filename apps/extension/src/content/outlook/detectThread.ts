import type { ThreadContext } from "../core/scheduler.js";
import { extractEmail } from "../gmail/detectThread.js";

// OWA DOM knowledge lives here and nowhere else.
//
// VERIFY (resolved by a manual load test, not asserted here): `data-convid` is
// the weakest external claim in this feature — its presence, and whether its
// value is byte-identical to the Graph `conversationId` we store as
// providerThreadId, are both unconfirmed. Mitigations, in order:
//   1. Every path returns null rather than guessing, so a wrong selector shows
//      no widget instead of a wrong one.
//   2. A value that does not match a stored thread 404s server-side and the
//      content script renders nothing.
//   3. If load testing shows a base64 / base64url mismatch, normalization goes
//      into the provider-threads route (one place, both callers) rather than here.

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
  return (
    main.querySelector("div[role='list']") ??
    main.querySelector("[role='listbox']") ??
    null
  );
}
