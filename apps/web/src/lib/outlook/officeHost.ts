// The Office.js surface the task pane uses, and nothing more.
//
// Typed locally rather than pulling in @types/office-js: the pane touches four
// members, and a hand-written slice keeps the dependency out of the web build
// while making the whole host mockable in tests with a plain object.

export type OfficeMailboxItem = {
  /** Graph conversationId for the read item. EWS-flavored in desktop Outlook. */
  conversationId?: string;
  itemId?: string;
  displayReplyForm(reply: string | { htmlBody: string }): void;
};

/** The one Office event the pane subscribes to. */
export const ITEM_CHANGED = "olkItemSelectedChanged";

export type OfficeLike = {
  onReady(callback?: (info: { host?: unknown; platform?: unknown }) => void): Promise<unknown>;
  /**
   * Office.EventType. Read off the host rather than hardcoded so a stubbed
   * Office in tests decides its own value, and so a host that spells the
   * constant differently still works. Falls back to the documented string.
   */
  EventType?: { ItemChanged?: string };
  context: {
    mailbox?: {
      item?: OfficeMailboxItem | null;
      userProfile?: { emailAddress?: string };
      /**
       * Present from Mailbox 1.5 (which the manifest requires). Only a pinned
       * pane ever fires ItemChanged — an unpinned one is torn down and rebuilt
       * per message, so it never needs the event.
       */
      addHandlerAsync?(
        eventType: string,
        handler: () => void,
        callback?: (result: { status?: string }) => void,
      ): void;
      removeHandlerAsync?(
        eventType: string,
        callback?: (result: { status?: string }) => void,
      ): void;
    };
  };
};

declare global {
  interface Window {
    Office?: OfficeLike;
  }
}

/** Where the current thread and mailbox come from, as the pane sees them. */
export type OutlookContext = {
  conversationId: string;
  accountEmail: string;
};

/**
 * Wait for Office to initialise. Rejects rather than hanging forever when the
 * page is opened outside Outlook (someone visiting the pane URL directly), so
 * the pane can say so instead of showing a spinner with no end.
 */
export async function whenOfficeReady(timeoutMs = 10_000): Promise<OfficeLike> {
  const office = window.Office;
  if (!office) throw new Error("office-unavailable");

  await Promise.race([
    office.onReady(),
    new Promise((_, reject) => setTimeout(() => reject(new Error("office-timeout")), timeoutMs)),
  ]);
  return office;
}

/**
 * The open message's conversation and the mailbox reading it. Returns null when
 * no message is selected — the pane can be opened from a folder view, where
 * there is nothing to reply to.
 *
 * The conversation id is passed on verbatim. Desktop Outlook hands out the EWS
 * base64 alphabet while Graph stores the URL-safe one, and that translation is
 * done server-side in normalizeProviderThreadId so the two callers (this pane and
 * the Gmail content script) cannot drift.
 */
export function readOutlookContext(office: OfficeLike): OutlookContext | null {
  const mailbox = office.context.mailbox;
  const conversationId = mailbox?.item?.conversationId;
  const accountEmail = mailbox?.userProfile?.emailAddress;
  if (!conversationId || !accountEmail) return null;
  return { conversationId, accountEmail };
}

/**
 * Report the open conversation, now and on every change.
 *
 * The pane can be pinned, and a pinned pane survives the user clicking through
 * their inbox: the document stays mounted while `context.mailbox.item` is
 * swapped underneath it. Without this subscription the pane would keep showing
 * the first message the user happened to open and quietly go stale — which is
 * worse than showing nothing, because it looks correct.
 *
 * Returns an unsubscribe. `addHandlerAsync` is optional on the type because an
 * unpinned pane in an older host may not have it; there, the pane is torn down
 * and rebuilt per message anyway, so losing the subscription costs nothing.
 */
export function subscribeOutlookContext(
  office: OfficeLike,
  listener: (context: OutlookContext | null) => void,
): () => void {
  listener(readOutlookContext(office));

  const mailbox = office.context.mailbox;
  const eventType = office.EventType?.ItemChanged ?? ITEM_CHANGED;
  if (!mailbox?.addHandlerAsync) return () => {};

  const handler = () => listener(readOutlookContext(office));
  try {
    mailbox.addHandlerAsync(eventType, handler);
  } catch {
    // A host that refuses the subscription still shows the message the pane
    // opened on; it simply will not follow along.
    return () => {};
  }

  return () => {
    try {
      mailbox.removeHandlerAsync?.(eventType);
    } catch {
      // Teardown is best-effort: the pane is going away regardless.
    }
  };
}

/**
 * Open Outlook's own reply form with the draft in it. This is the only mailbox
 * write the add-in ever performs: Outlook composes and the user sends, exactly
 * as they would without Amarnai. Nothing here can send mail.
 */
export function insertReplyDraft(office: OfficeLike, htmlBody: string): void {
  const item = office.context.mailbox?.item;
  if (!item) throw new Error("no-item");
  item.displayReplyForm({ htmlBody });
}
