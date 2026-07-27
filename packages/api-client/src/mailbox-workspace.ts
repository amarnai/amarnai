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
 * `gmailConnection` is provider-agnostic despite its name: it returns whichever
 * address the workspace has connected, Gmail or Outlook, so this resolves both.
 *
 * O(workspaces) round trips. Callers on a hot path should cache the result;
 * a dedicated endpoint would collapse it to one call.
 */
export async function resolveWorkspaceIdForMailbox(
  api: Pick<ApiClient, "workspaces" | "gmailConnection">,
  mailboxEmail: string,
): Promise<string | null> {
  const key = mailboxEmail.toLowerCase();
  const workspaces = await api.workspaces();
  for (const workspace of workspaces) {
    const connection = await api.gmailConnection(workspace.id);
    if (connection?.gmailAddress?.toLowerCase() === key) return workspace.id;
  }
  return null;
}
