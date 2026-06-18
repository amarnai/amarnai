import * as Notifications from 'expo-notifications';
import type { ApiClient } from '@amarnai/api-client';
import { THREAD_ACTION_MARK_REVIEWED, THREAD_ACTION_OPEN } from './categories';

// Shape of the payload the worker attaches to every triage push (notify-threads.ts).
interface ThreadPushData {
  workspaceId?: unknown;
  emailThreadId?: unknown;
}

export interface NotificationActionDeps {
  // Only the readonly state change is exposed here — no Gmail-write methods.
  client: Pick<ApiClient, 'markThreadDone'>;
  userId: string;
  navigateToThread: (workspaceId: string, threadId: string) => void;
}

/**
 * Dispatches a tapped notification or one of its inline actions.
 *
 * - Body tap / "Open" → deep-link to the thread.
 * - "Mark reviewed"   → resolve the thread in Amarnai state (readonly; never
 *                       touches Gmail).
 *
 * Pure over its deps so it can be unit-tested without a device. Unknown payloads
 * are ignored rather than throwing.
 */
export async function handleNotificationResponse(
  response: Notifications.NotificationResponse,
  deps: NotificationActionDeps,
): Promise<void> {
  const data = response.notification.request.content.data as ThreadPushData;
  const workspaceId = typeof data.workspaceId === 'string' ? data.workspaceId : null;
  const emailThreadId = typeof data.emailThreadId === 'string' ? data.emailThreadId : null;
  if (!workspaceId || !emailThreadId) return;

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
