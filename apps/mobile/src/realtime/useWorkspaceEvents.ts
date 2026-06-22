import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import EventSource from 'react-native-sse';
import { API_BASE_URL } from '../config';
import { secureTokenStore } from '../auth/tokenStore';
import { useSession } from '../auth/session';

// The only server event we act on. The stream also emits `connected` (handshake)
// and `heartbeat` (keep-alive), which we deliberately ignore.
type WorkspaceEvent = 'synced';

const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

/**
 * Subscribe to the workspace Server-Sent Events stream and call `onSynced`
 * whenever the worker finishes a sync, so the caller can refresh immediately —
 * the mobile counterpart to the web app's EventSource on the emails page.
 *
 * Foreground- and focus-gated: pass `null` for `workspaceId` to disconnect (e.g.
 * while the emails screen is not focused). The connection is also dropped when
 * the app backgrounds and re-opened when it returns to the foreground, so no
 * socket is held open in the background. Reconnection is managed manually with
 * exponential backoff, refreshing the access token on each attempt.
 */
export function useWorkspaceEvents(
  workspaceId: string | null,
  onSynced: () => void,
): void {
  const { client } = useSession();

  // Stable refs so the long-lived connect loop never captures stale closures.
  const onSyncedRef = useRef(onSynced);
  onSyncedRef.current = onSynced;
  const clientRef = useRef(client);
  clientRef.current = client;

  useEffect(() => {
    if (!workspaceId) return;

    let cancelled = false;
    let es: EventSource<WorkspaceEvent> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let backoff = INITIAL_BACKOFF_MS;

    const clearReconnect = () => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const close = () => {
      clearReconnect();
      if (es) {
        es.removeAllEventListeners();
        es.close();
        es = null;
      }
    };

    const scheduleReconnect = () => {
      clearReconnect();
      const delay = backoff;
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
      reconnectTimer = setTimeout(() => {
        void connect();
      }, delay);
    };

    const connect = async () => {
      if (cancelled || AppState.currentState !== 'active') return;
      close(); // never run more than one live connection

      // Refresh the access token if it has expired by piggybacking on the
      // transport's single-flight 401-refresh, then read the (possibly rotated)
      // token for the connection. A still-valid token makes this a no-op retry.
      try {
        await clientRef.current.me();
      } catch {
        // A failed ping (e.g. offline) just means we fall through and either
        // connect with the current token or back off below.
      }
      if (cancelled) return;
      const accessToken = (await secureTokenStore.get())?.accessToken ?? null;
      if (cancelled) return;
      if (!accessToken) {
        scheduleReconnect();
        return;
      }

      const next = new EventSource<WorkspaceEvent>(
        `${API_BASE_URL}/workspaces/${encodeURIComponent(workspaceId)}/events`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          // Manage reconnection ourselves so each retry uses a fresh token.
          pollingInterval: 0,
        },
      );
      es = next;

      next.addEventListener('open', () => {
        backoff = INITIAL_BACKOFF_MS; // reset once a connection is healthy
      });
      next.addEventListener('synced', () => {
        onSyncedRef.current();
      });
      next.addEventListener('error', () => {
        if (cancelled) return;
        close();
        scheduleReconnect();
      });
    };

    void connect();

    // Drop the socket in the background; re-open on return to the foreground.
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        backoff = INITIAL_BACKOFF_MS;
        void connect();
      } else {
        close();
      }
    });

    return () => {
      cancelled = true;
      sub.remove();
      close();
    };
  }, [workspaceId]);
}
