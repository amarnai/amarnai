import type { ThreadContext } from "../core/scheduler.js";

// Gmail DOM knowledge lives here and nowhere else.
//
// Live-verified 2026-07-27 on a real account: data-legacy-thread-id exists and
// its value matches our stored providerThreadId (the API resolved it), and the
// account selectors below read the visible mailbox correctly. Still unverified:
// data-thread-perm-id equivalence and the URL-hash shape on newer accounts.
// Every path returns null rather than guessing, so a wrong selector degrades to
// "no widget" — never a wrong one.

/**
 * Gmail marks each open conversation with its API thread id. `data-legacy-thread-id`
 * is the one that equals the Gmail API `threads.get` id — which is what we store
 * as providerThreadId. `data-thread-perm-id` is the newer permanent id and is
 * checked as a secondary source.
 */
const THREAD_ID_ATTRIBUTES = ["data-legacy-thread-id", "data-thread-perm-id"];

/**
 * Gmail thread ids are lowercase hex. Newer accounts put a non-API token in the
 * URL hash, so a hash segment is only trusted when it looks like a real id — the
 * DOM attribute is always authoritative when present.
 */
const HEX_THREAD_ID = /^[0-9a-f]{16,}$/;

/**
 * Marks an element as a rendered message inside an open conversation. List rows
 * carry thread-id attributes but never message ids, which is what makes this the
 * discriminator between "a conversation is open" and "we are looking at the list".
 */
const MESSAGE_MARKER = "[data-legacy-message-id], [data-message-id]";

/**
 * The container of the OPEN conversation. Never a global query: Gmail keeps
 * hidden views in the document — the thread list (whose rows also carry
 * data-legacy-thread-id) and preloaded conversations — so the first
 * [data-legacy-thread-id] in document order is routinely some OTHER thread.
 * That was a live bug: the widget showed an accurate summary of the first list
 * row over a different open thread.
 *
 * Selection: among role=main regions that contain rendered messages, prefer a
 * visible one (offsetParent is null inside display:none subtrees). jsdom has no
 * layout, so offsetParent is always null there — fall back to the last
 * candidate, which in real Gmail is also the most recently rendered view.
 */
export function findConversationRoot(doc: Document = document): Element | null {
  const mains = Array.from(doc.querySelectorAll("div[role='main']"));
  const conversations = mains.filter((m) => m.querySelector(MESSAGE_MARKER));
  if (conversations.length === 0) return null;
  const visible = conversations.filter((m) => (m as HTMLElement).offsetParent !== null);
  return visible[0] ?? conversations[conversations.length - 1]!;
}

export function findThreadId(doc: Document = document): string | null {
  const root = findConversationRoot(doc);
  if (root) {
    for (const attribute of THREAD_ID_ATTRIBUTES) {
      // The attribute may sit inside the conversation region or on an ancestor
      // of it; both are scoped to THIS conversation. Never the whole document.
      const el = root.querySelector(`[${attribute}]`) ?? root.closest(`[${attribute}]`);
      const value = el?.getAttribute(attribute)?.trim();
      if (value) return normalizeThreadId(value);
    }
  }
  return threadIdFromHash(doc.location?.hash ?? "");
}

/**
 * Gmail sometimes prefixes the attribute value with "thread-f:" / "thread-a:".
 * The API id is the part after the colon.
 */
function normalizeThreadId(raw: string): string {
  const colon = raw.lastIndexOf(":");
  return colon === -1 ? raw : raw.slice(colon + 1);
}

/**
 * Last resort: the trailing segment of the URL hash (#inbox/<id>), accepted only
 * when it looks like a Gmail thread id. Exported for the detection tests.
 */
export function threadIdFromHash(hash: string): string | null {
  const segment = hash.replace(/^#/, "").split("?")[0]?.split("/").pop()?.trim();
  if (!segment) return null;
  return HEX_THREAD_ID.test(segment.toLowerCase()) ? segment.toLowerCase() : null;
}

/**
 * The mailbox currently shown in the UI. Under multi-login (/u/0, /u/1, …) the
 * signed-in Aziru account may not be the one on screen, and summarizing the
 * wrong mailbox would be worse than summarizing nothing — so no address means
 * no widget.
 *
 * Gmail exposes it on the account switcher's aria-label ("Google Account: Ada
 * (ada@example.com)") and on the profile image's title.
 */
export function findAccountEmail(doc: Document = document): string | null {
  const candidates = [
    doc.querySelector("a[aria-label*='@']")?.getAttribute("aria-label"),
    doc.querySelector("img[aria-label*='@']")?.getAttribute("aria-label"),
    doc.querySelector("[data-email]")?.getAttribute("data-email"),
    doc.querySelector("img.gb_P[title*='@']")?.getAttribute("title"),
  ];
  for (const candidate of candidates) {
    const email = extractEmail(candidate);
    if (email) return email;
  }
  return null;
}

/** Pull the first plausible address out of a label string. */
export function extractEmail(label: string | null | undefined): string | null {
  if (!label) return null;
  const match = label.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  return match ? match[0].toLowerCase() : null;
}

export function detectGmailThread(doc: Document = document): ThreadContext | null {
  const providerThreadId = findThreadId(doc);
  if (!providerThreadId) return null;
  return { providerThreadId, accountEmail: findAccountEmail(doc) };
}

/**
 * Where to put the card: immediately above the conversation's message list.
 * Derived from the SAME conversation root as the thread id, so the id and the
 * injection point can never disagree about which conversation they belong to.
 */
export function findGmailInjectionAnchor(doc: Document = document): Element | null {
  const root = findConversationRoot(doc);
  if (!root) return null;
  return root.querySelector("div[role='list']") ?? root.querySelector(MESSAGE_MARKER);
}
