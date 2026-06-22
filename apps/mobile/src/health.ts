import { useEffect, useState } from 'react';
import { API_BASE_URL } from './config';

export type HealthState =
  | { status: 'checking' }
  | { status: 'ok' }
  | { status: 'unreachable'; error: string };

/**
 * Pings the local API's public /health endpoint so a physical device can confirm
 * it actually reaches the dev machine over LAN. No auth required. This is dev
 * connectivity scaffolding for Slice 0; later slices talk to the API through the
 * authenticated @amarnai/api-client transport instead.
 */
export function useApiHealth(): HealthState {
  const [state, setState] = useState<HealthState>({ status: 'checking' });

  useEffect(() => {
    // Dev-only connectivity scaffolding: never ping or surface state from
    // production builds (see the dev-gated footer in sign-in.tsx).
    if (!__DEV__) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/health`);
        if (cancelled) return;
        if (!res.ok) {
          setState({ status: 'unreachable', error: `HTTP ${res.status}` });
          return;
        }
        const body = (await res.json()) as { ok?: boolean };
        setState(body.ok ? { status: 'ok' } : { status: 'unreachable', error: 'Unexpected response' });
      } catch (err) {
        if (cancelled) return;
        setState({ status: 'unreachable', error: err instanceof Error ? err.message : String(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
