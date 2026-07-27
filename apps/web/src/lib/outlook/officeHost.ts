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

export type OfficeLike = {
  onReady(callback?: (info: { host?: unknown; platform?: unknown }) => void): Promise<unknown>;
  context: {
    mailbox?: {
      item?: OfficeMailboxItem | null;
      userProfile?: { emailAddress?: string };
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
 * Open Outlook's own reply form with the draft in it. This is the only mailbox
 * write the add-in ever performs: Outlook composes and the user sends, exactly
 * as they would without Amarnai. Nothing here can send mail.
 */
export function insertReplyDraft(office: OfficeLike, htmlBody: string): void {
  const item = office.context.mailbox?.item;
  if (!item) throw new Error("no-item");
  item.displayReplyForm({ htmlBody });
}
