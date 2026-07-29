import type { ApiClient } from "./client.js";

/**
 * Map a mailbox address to the workspace that has it connected.
 *
 * Every surface that is injected into a mail client faces the same problem: the
 * page knows which mailbox the user is looking at, but every Amarnai API call is
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
  mailboxEmail: string,
): Promise<string | null> {
  const key = mailboxEmail.toLowerCase();
  const { accounts } = await api.mailAccounts();
  // The endpoint already lowercases, but fold again here: mailbox matching is
  // case-insensitive by contract, and that contract should not depend on which
  // API version the client happens to be talking to.
  return accounts.find((a) => a.email.toLowerCase() === key)?.workspaceId ?? null;
}
