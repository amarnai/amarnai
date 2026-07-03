import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useSession } from '../auth/session';
import type { NotificationItem } from '@amarnai/api-client';

// Poll cadence for the unread badge. Immediacy is covered by push on mobile, so
// a light foreground poll is enough; the count also refreshes whenever the app
// returns to the foreground.
const POLL_MS = 60_000;

interface UseNotifications {
  unread: number;
  items: NotificationItem[];
  loading: boolean;
  /** Fetch the feed (call when opening the sheet). */
  load: () => void;
  /** Mark everything read and clear the badge (call on sheet open). */
  markAllRead: () => void;
  refreshCount: () => void;
}

export function useNotifications(): UseNotifications {
  const { client, status } = useSession();
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);

  const signedIn = status === 'signedIn';

  const refreshCount = useCallback(() => {
    if (!signedIn) return;
    client.notificationsUnreadCount()
      .then(({ count }) => setUnread(count))
      .catch(() => {});
  }, [client, signedIn]);

  // Poll + refresh on foreground.
  useEffect(() => {
    if (!signedIn) return;
    refreshCount();
    const interval = setInterval(refreshCount, POLL_MS);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') refreshCount();
    });
    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, [signedIn, refreshCount]);

  const load = useCallback(() => {
    setLoading(true);
    client.notifications(undefined, 30)
      .then(({ notifications }) => setItems(notifications))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [client]);

  const markAllRead = useCallback(() => {
    setUnread(0);
    client.markAllNotificationsRead().catch(() => {});
  }, [client]);

  return { unread, items, loading, load, markAllRead, refreshCount };
}
