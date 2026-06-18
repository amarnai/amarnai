import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { PUSH_CATEGORY_THREAD_NEEDS_ATTENTION, PUSH_CHANNEL_TRIAGE } from '@amarnai/shared';

// Inline notification action ids for the "thread needs attention" category.
//
// v1 is READONLY (CLAUDE.md safety invariants): both actions are read-oriented
// and touch only Amarnai's own state. Neither performs a Gmail write or send —
// no archive, no reply, no label change in Gmail. Write actions are deferred to
// the email-client phase along with the gmail.modify scope.
export const THREAD_ACTION_OPEN = 'open_thread';
export const THREAD_ACTION_MARK_REVIEWED = 'mark_reviewed';

/**
 * Registers the Android notification category (inline actions) and the triage
 * channel. Idempotent — safe to call on every app start. Must run before any
 * push arrives so the OS can render the action buttons.
 */
export async function registerNotificationCategories(): Promise<void> {
  await Notifications.setNotificationCategoryAsync(PUSH_CATEGORY_THREAD_NEEDS_ATTENTION, [
    {
      identifier: THREAD_ACTION_OPEN,
      buttonTitle: 'Open',
      // Bring the app forward and deep-link to the thread.
      options: { opensAppToForeground: true },
    },
    {
      identifier: THREAD_ACTION_MARK_REVIEWED,
      buttonTitle: 'Mark reviewed',
      // Resolves the thread in Amarnai state without opening the app. This is an
      // Amarnai-internal status change only — it does NOT touch Gmail.
      options: { opensAppToForeground: false },
    },
  ]);

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(PUSH_CHANNEL_TRIAGE, {
      name: 'Triage',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
}
