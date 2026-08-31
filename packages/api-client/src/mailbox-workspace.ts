import type { ApiClient } from "./client.js";
import type { MailAccount } from "./types.js";

/**
 * Which connected mailbox a surface is looking at, or null if that cannot be
 * settled. The one place this rule lives; every injected surface shares it.
 *
 * An address read off the page is matched against the connected mailboxes and
 * nothing else: on a multi-login page, answering with another mailbox because its
 * address happened to be the one we could parse is the failure this matching
 * exists to prevent.
 *
 * A null address is the interesting case, and the answer is the single connected
 * mailbox — but only when there is exactly one, never a pick from several. Some
 * mail layouts name no mailbox anywhere: OWA's standalone deeplink read view has
 * neither an account header nor a folder tree, and before this the injected
 * surfaces had nothing to say on it at all.
 *
 * What keeps that from being a guess is that the thread path verifies it
 * downstream — the thread id still has to resolve inside that mailbox's
 * workspace, so a page in fact showing some OTHER mailbox resolves to nothing
 * rather than to another conversation's data.
 */
export function resolveMailboxAccount(
  accounts: MailAccount[],
  mailboxEmail: string | null,
): MailAccount | null {
  if (mailboxEmail) {
    // The endpoint already lowercases, but fold again here: mailbox matching is
    // case-insensitive by contract, and that contract should not depend on which
    // API version the client happens to be talking to.
    const key = mailboxEmail.toLowerCase();
    return accounts.find((a) => a.email.toLowerCase() === key) ?? null;
  }
  return accounts.length === 1 ? accounts[0]! : null;
}

/**
 * Map a mailbox address to the workspace that has it connected.
 *
 * Every surface that is injected into a mail client faces the same problem: the
 * page knows which mailbox the user is looking at, but every Aziru API call is
 * keyed by workspace. Shared by the browser extension and the Outlook task pane
 * so the two can never disagree about which workspace a mailbox belongs to.
 *
 * Returns null when the signed-in user has no workspace for that address, which
 * is the ordinary case under multi-login (a second Gmail account in the same
 * browser, say) and means "this surface has nothing to offer here".
 *
 * One round trip: /me/mail-accounts answers for every workspace at once. It
 * used to walk the workspace list and fetch each connection in turn, which put
 * O(workspaces) requests on the critical path of opening a thread. Callers on a
 * hot path may still cache the result.
 */
export async function resolveWorkspaceIdForMailbox(
  api: Pick<ApiClient, "mailAccounts">,
  mailboxEmail: string | null,
): Promise<string | null> {
  const { accounts } = await api.mailAccounts();
  return resolveMailboxAccount(accounts, mailboxEmail)?.workspaceId ?? null;
}
