import type { NotificationItem } from "@aziru/api-client";
import { switchWorkspaceAction } from "@/actions/workspace";
import type { NotificationAction } from "@/lib/notifications";

// Minimal router surface so this util does not need to import Next's router type;
// `useRouter().push` satisfies it structurally.
type Nav = { push: (href: string) => void };

/**
 * Perform a notification's click action. Shared by the bell pop-up and the full
 * notifications page so both dispatch identically. Callers own the read/dismiss
 * bookkeeping (it differs per surface); this only navigates.
 *
 * In-app navigation targets the notification's OWN workspace: when that differs
 * from the selected one, the server action switches the workspace cookie first
 * and then redirects, so the destination renders the right tenant. Same
 * workspace: a soft client push. The Gmail reconnect flow is a full-page nav into
 * the OAuth route (which re-authorizes against `workspaceId`); external links
 * open in a new tab.
 */
export function runNotificationAction(
  action: NotificationAction,
  n: NotificationItem,
  ctx: { router: Nav; currentWorkspaceId: string | null },
): void {
  const navigate = (target: string) => {
    // Switch only when we know the current workspace and it differs; an unknown
    // current workspace falls back to a soft push (matches prior behavior).
    if (ctx.currentWorkspaceId && n.workspaceId !== ctx.currentWorkspaceId) {
      void switchWorkspaceAction(n.workspaceId, target);
    } else {
      ctx.router.push(target);
    }
  };

  switch (action.kind) {
    case "open_url":
      window.open(action.href, "_blank", "noopener,noreferrer");
      return;
    case "open_thread":
      navigate(`/emails?t=${encodeURIComponent(action.threadId)}`);
      return;
    case "navigate":
      navigate(action.path);
      return;
    case "reconnect_gmail":
      // Full-page nav into the OAuth route: it 302s to Google. The route is
      // owner-gated; a non-owner member is bounced there, which is the intended
      // authorization boundary.
      window.location.assign(`/api/gmail/connect?workspaceId=${encodeURIComponent(n.workspaceId)}`);
      return;
  }
}
