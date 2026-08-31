import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import {
  PUSH_CATEGORY_THREAD_NEEDS_ATTENTION,
  PUSH_CATEGORY_THREAD_ASSIGNED,
  PUSH_CATEGORY_GMAIL_DISCONNECTED,
  PUSH_CHANNEL_TRIAGE,
} from '@aziru/shared';

// Inline notification action ids for the "thread needs attention" category.
//
// v1 is READONLY (CLAUDE.md safety invariants): both actions are read-oriented
// and touch only Aziru's own state. Neither performs a Gmail write or send —
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
      // Resolves the thread in Aziru state without opening the app. This is an
      // Aziru-internal status change only — it does NOT touch Gmail.
      options: { opensAppToForeground: false },
    },
  ]);

  // "Assigned to you" category. A single Open action — tapping deep-links to the
  // thread via the same default-action path in handleNotificationResponse. No
  // mark-reviewed here: assignment is about ownership, not completion.
  await Notifications.setNotificationCategoryAsync(PUSH_CATEGORY_THREAD_ASSIGNED, [
    {
      identifier: THREAD_ACTION_OPEN,
      buttonTitle: 'Open',
      options: { opensAppToForeground: true },
    },
  ]);

  // "Gmail disconnected" category. No inline actions — tapping the body opens the
  // emails tab (reconnect banner) via the default-action path. Registered so the
  // category id resolves on Android even though it carries no buttons.
  await Notifications.setNotificationCategoryAsync(PUSH_CATEGORY_GMAIL_DISCONNECTED, []);

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(PUSH_CHANNEL_TRIAGE, {
      name: 'Triage',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
}
