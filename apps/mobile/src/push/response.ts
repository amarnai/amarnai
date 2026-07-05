import * as Notifications from 'expo-notifications';
import { PUSH_CATEGORY_GMAIL_DISCONNECTED } from '@amarnai/shared';
import type { ApiClient } from '@amarnai/api-client';
import { THREAD_ACTION_MARK_REVIEWED, THREAD_ACTION_OPEN } from './categories';

// Shape of the payload the worker attaches to a push. Thread pushes carry an
// emailThreadId; the gmail_disconnected push carries only workspaceId + type.
interface PushData {
  workspaceId?: unknown;
  emailThreadId?: unknown;
  type?: unknown;
}

export interface NotificationActionDeps {
  // Only the readonly state change is exposed here — no Gmail-write methods.
  client: Pick<ApiClient, 'markThreadDone'>;
  userId: string;
  navigateToThread: (workspaceId: string, threadId: string) => void;
  // Deep-link to the emails tab, which hosts the reconnect banner.
  navigateToEmails: (workspaceId: string) => void;
}

/**
 * Dispatches a tapped notification or one of its inline actions.
 *
 * - Gmail disconnected → deep-link to the emails tab (reconnect banner lives there).
 * - Body tap / "Open"  → deep-link to the thread.
 * - "Mark reviewed"    → resolve the thread in Amarnai state (readonly; never
 *                        touches Gmail).
 *
 * Pure over its deps so it can be unit-tested without a device. Unknown payloads
 * are ignored rather than throwing.
 */
export async function handleNotificationResponse(
  response: Notifications.NotificationResponse,
  deps: NotificationActionDeps,
): Promise<void> {
  const data = response.notification.request.content.data as PushData;
  const workspaceId = typeof data.workspaceId === 'string' ? data.workspaceId : null;
  if (!workspaceId) return;

  // The Gmail-disconnected push has no thread; tapping it opens the emails tab
  // (which surfaces the reconnect banner). Handle before the thread guard.
  if (data.type === PUSH_CATEGORY_GMAIL_DISCONNECTED) {
    deps.navigateToEmails(workspaceId);
    return;
  }

  const emailThreadId = typeof data.emailThreadId === 'string' ? data.emailThreadId : null;
  if (!emailThreadId) return;

  switch (response.actionIdentifier) {
    case THREAD_ACTION_MARK_REVIEWED:
      await deps.client.markThreadDone(workspaceId, emailThreadId, deps.userId);
      return;
    case THREAD_ACTION_OPEN:
    case Notifications.DEFAULT_ACTION_IDENTIFIER:
    default:
      deps.navigateToThread(workspaceId, emailThreadId);
      return;
  }
}
